import { createHash } from "node:crypto";
import { addAuditEntry, customerDecision, processShelfEvent, staffDecision, startSession, checkout } from "../domain.mjs";
import { ingestTelemetry } from "../evidence.mjs";
import { completeCaseInvestigation } from "../agent/case-manager.mjs";
import { queryStatistics } from "../stats-query.mjs";
import { authenticate, basketId, httpError, requireOwner, requireStaff, scopedState, signShopper, verifyPairing } from "./auth.mjs";
import { createCloudServices } from "./services.mjs";
import { SHELF_IDS } from "../shelves.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const caseId = value => { if (!/^CASE-\d+$/.test(value || "")) throw httpError(400, "Invalid case ID"); return value; };
const reply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });
function bodyOf(event, maxBytes = 64000) {
  if (event.isBase64Encoded || Buffer.byteLength(event.body || "") > maxBytes) throw httpError(400, "Invalid request size or encoding");
  try { return JSON.parse(event.body || "{}"); } catch { throw httpError(400, "Invalid JSON"); }
}
const tokenKey = (id, actor) => `HITL#${id}#${actor.toUpperCase()}`;

export function createCloudHandlers(services) {
  const { repository } = services;
  async function launch(item) {
    if (!item || item.status === "CLOSED") return;
    await services.startWorkflow(item);
    await repository.mutate(draft => { if (draft.cloudWorkflows?.[item.caseId]) draft.cloudWorkflows[item.caseId].launched = true; });
  }
  async function resumeDecision(id, actor) {
    const handoff = await services.get(tokenKey(id, actor));
    const stored = (await repository.read()).cloudDecisions?.[`${id}#${actor}`];
    if (!handoff || !stored || handoff.completed) return;
    await services.resume(handoff.taskToken, { caseId: id, nextAction: stored.nextAction });
    await services.put({ ...handoff, completed: true });
  }

  return {
    async api(event) {
      try {
        const method = event.requestContext?.http?.method, path = event.rawPath;
        const principal = await authenticate(event.headers || {}, { key: await services.key(), verifyJwt: token => services.verifyJwt(token) });
        if (method === "GET" && path === "/api/auth/me") { requireStaff(principal); return reply(200, { email: principal.email, expiresAt: principal.exp * 1000 }); }
        if (method === "GET" && path === "/api/state") return reply(200, scopedState(await repository.read(), principal));
        if (method === "GET" && path === "/api/audit") { requireStaff(principal); const store = await repository.read(); return reply(200, { items: store.auditLog.slice(0, 100) }); }
        if (method === "POST" && path === "/api/vision/live") {
          requireStaff(principal);
          const frame = bodyOf(event, 700000);
          if (!/^[a-f0-9-]{36}$/.test(frame.cameraSession || "") || typeof frame.jpeg !== "string" || frame.jpeg.length > 682668 ||
              !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.jpeg) || Buffer.from(frame.jpeg, "base64").toString("base64") !== frame.jpeg) throw httpError(400, "Invalid camera frame");
          return reply(200, await services.invokeAgent({ type: "LIVE_VISION", cameraSession: frame.cameraSession, jpeg: frame.jpeg }));
        }
        const body = bodyOf(event);
        if (method === "POST" && path === "/api/events") {
          requireStaff(principal);
          if (!services.demoSignalsEnabled) throw httpError(403, "Cloud demo signals are disabled");
          const allowed = ["eventId", "shelfId", "laneId", "eventType", "rssi"];
          if (Object.keys(body).some(key => !allowed.includes(key)) || !/^web-demo-[a-f0-9-]{36}$/.test(body.eventId || "") ||
              !["SHELF-01", "SHELF-02", "SHELF-03"].includes(body.shelfId)) throw httpError(400, "Invalid demo signal");
          const { result, store } = await repository.mutate(draft => {
            const received = draft.cloudReceipts?.find(item => item.eventId === body.eventId);
            if (received) { addAuditEntry(draft, "DUPLICATE_EVENT_IGNORED", "STAFF_SIMULATOR", { eventId: body.eventId, staffSub: principal.sub }); return { duplicate: true, eventId: body.eventId, caseId: received.caseId }; }
            const result = processShelfEvent(draft, body);
            const recorded = draft.events.find(item => item.eventId === body.eventId);
            if (recorded) recorded.source = "SIMULATOR";
            const receivedAudit = draft.auditLog.find(item => item.action === "SHELF_EVENT_RECEIVED" && item.details.eventId === body.eventId);
            if (receivedAudit) { receivedAudit.actor = "STAFF_SIMULATOR"; receivedAudit.details.staffSub = principal.sub; }
            const item = draft.cases.find(item => item.eventId === body.eventId);
            if (item) { draft.cloudWorkflows ||= {}; draft.cloudWorkflows[item.caseId] ||= { launched: false }; }
            draft.cloudReceipts ||= []; draft.cloudReceipts.push({ eventId: body.eventId, caseId: item?.caseId || null });
            return result;
          });
          const item = store.cases.find(item => item.eventId === body.eventId);
          if (item && !store.cloudWorkflows[item.caseId].launched) await launch(item);
          return reply(200, result);
        }
        if (method === "POST" && path === "/api/realtime-ticket") return reply(200, await services.ticket(principal));
        if (method === "POST" && path === "/api/sessions") {
          const basket = basketId(body.basketId), key = await services.key();
          if (body.action === "RELEASE") {
            requireStaff(principal);
            await repository.mutate(store => {
              const view = scopedState(store, principal).baskets.find(item => item.basketId === basket);
              if (view.lines.length || view.unresolvedCaseCount) throw httpError(409, "Resolve cases and empty the cart before releasing this basket");
              const session = store.sessions.find(item => item.sessionId === store.activeSessions[basket]);
              if (session) { session.status = "CLOSED"; session.closedAt = new Date().toISOString(); store.activeSessions[basket] = null; addAuditEntry(store, "EMPTY_BASKET_RELEASED", "STAFF", { basketId: basket, sessionId: session.sessionId, staffSub: principal.sub }); }
            });
            return reply(200, { ok: true });
          }
          const { result: session } = await repository.mutate(store => {
            const attempt = typeof body.pairingAttempt === "string" && /^[a-f0-9-]{36}$/.test(body.pairingAttempt) ? body.pairingAttempt : null;
            if (store.activeSessions[basket]) {
              if (attempt && store.cloudPairing?.[basket]?.attempt === attempt && store.cloudPairing[basket].sessionId === store.activeSessions[basket]) verifyPairing(key, basket, body.pairingCode);
              else requireOwner(principal, store, basket);
              return store.sessions.find(item => item.sessionId === store.activeSessions[basket]);
            }
            if (principal.role !== "STAFF") verifyPairing(key, basket, body.pairingCode);
            const session = startSession(store, basket);
            if (attempt) { store.cloudPairing ||= {}; store.cloudPairing[basket] = { attempt, sessionId: session.sessionId }; }
            return session;
          });
          return reply(201, { session, shopperToken: signShopper(key, { basket, sessionId: session.sessionId }) });
        }
        if (method === "POST" && path === "/api/checkout") {
          const basket = basketId(body.basketId);
          const { result: order } = await repository.mutate(store => { requireOwner(principal, store, basket); return checkout(store, basket); });
          return reply(200, { order });
        }
        if (method === "POST" && path === "/api/stats/query") {
          requireStaff(principal);
          const result = await queryStatistics(repository, body, { planner: parameters => services.invokeAgent({ type: "STAT_PLAN", ...parameters }) });
          await repository.mutate(store => addAuditEntry(store, "STAT_QUERY_COMPLETED", "STAFF", { queryId: result.queryId, plan: result.plan, source: result.source, staffSub: principal.sub }));
          return reply(200, result);
        }
        const route = /^\/api\/cases\/(CASE-\d+)\/(customer|staff)$/.exec(path);
        if (method === "POST" && route) {
          const [, id, actor] = route;
          if (actor === "staff") requireStaff(principal);
          const handoff = await services.get(tokenKey(id, actor));
          const fingerprint = hash({ body, actor, owner: principal.sub || principal.sessionId });
          const { result: item } = await repository.mutate(store => {
            const item = store.cases.find(item => item.caseId === id); if (!item) throw httpError(404, "Case not found");
            if (actor === "customer") requireOwner(principal, store, item.candidate);
            const previous = store.cloudDecisions?.[`${id}#${actor}`];
            if (previous) { if (previous.fingerprint !== fingerprint) throw httpError(409, "A different decision was already recorded"); return item; }
            if (!handoff || handoff.completed || handoff.expiresAt * 1000 <= Date.now()) throw httpError(409, "The workflow is not waiting for this decision; reload state");
            const result = actor === "customer" ? customerDecision(store, id, String(body.answer || "").toUpperCase()) : staffDecision(store, id, String(body.decision || "").toUpperCase(), String(body.basketId || "").toUpperCase());
            store.cloudDecisions ||= {}; store.cloudDecisions[`${id}#${actor}`] = { fingerprint, nextAction: result.nextAction, at: new Date().toISOString() };
            addAuditEntry(store, "AUTHORIZED_HUMAN_DECISION", actor.toUpperCase(), { caseId: id, principal: principal.sub || principal.sessionId });
            return result;
          });
          await resumeDecision(id, actor);
          return reply(200, { case: actor === "staff" ? item : { ...item, evidence: { zone: item.evidence.zone }, toolCalls: [], timeline: [], agent: undefined } });
        }
        return reply(404, { error: "Cloud route not available" });
      } catch (error) {
        console.error(JSON.stringify({ event: "CLOUD_API_ERROR", requestId: event.requestContext?.requestId, status: error.status || 409, message: error.message }));
        return reply(error.status || 409, { error: error.status ? error.message : "Request failed; refresh state before retrying" });
      }
    },

    async ingest(event) {
      const match = /^smartbasket\/shelf\/([A-Z0-9-]+)\/(events|telemetry)$/.exec(event.mqttTopic || "");
      if (!match || !SHELF_IDS.includes(match[1]) || event.mqttClientId !== match[1] || event.shelfId !== match[1]) throw new Error("IoT topic/client/shelf identity mismatch");
      if (match[2] === "telemetry") { await repository.mutate(store => ingestTelemetry(store, { ...event, source: "DEVICE" })); return { ok: true }; }
      if (event.mockVisionFrameId !== undefined || event.agentMode !== undefined) throw new Error("Device cannot inject mock Agent evidence");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(event.eventId || "")) throw new Error("Invalid device event ID");
      const { result, store } = await repository.mutate(draft => {
        const received = draft.cloudReceipts?.find(item => item.eventId === event.eventId);
        if (received) { addAuditEntry(draft, "DUPLICATE_EVENT_IGNORED", "FSM", { eventId: event.eventId }); return { duplicate: true, eventId: event.eventId, caseId: received.caseId }; }
        const result = processShelfEvent(draft, event);
        const item = result.caseId ? draft.cases.find(item => item.caseId === result.caseId) : draft.cases.find(item => item.eventId === event.eventId);
        if (item) { draft.cloudWorkflows ||= {}; draft.cloudWorkflows[item.caseId] ||= { launched: false }; }
        draft.cloudReceipts ||= []; draft.cloudReceipts.push({ eventId: event.eventId, caseId: item?.caseId || null });
        draft.seenEventIds = draft.seenEventIds.slice(-100);
        return result;
      });
      const item = store.cases.find(item => item.eventId === event.eventId);
      if (item && !store.cloudWorkflows[item.caseId].launched) await launch(item);
      await services.acknowledge(match[1], event.eventId);
      return result;
    },

    async investigate(event) {
      const id = caseId(event.caseId);
      if (!event.investigate) return { caseId: id, nextAction: "STAFF_HITL" };
      try {
        const result = await services.invokeAgent({ type: "CASE", caseId: id });
        if (result.caseId !== id || !["CUSTOMER_CONFIRM", "STAFF_HITL"].includes(result.nextAction)) throw new Error("Invalid Agent result");
        return result;
      }
      catch (error) {
        const { result } = await repository.mutate(store => completeCaseInvestigation(store, id, { error: "Cloud Agent unavailable; staff review required" }, { provider: "BEDROCK" }));
        return { caseId: id, nextAction: result.nextAction };
      }
    },

    async handoff(event) {
      const id = caseId(event.caseId), actor = event.stage;
      if (!["CUSTOMER", "STAFF"].includes(actor) || typeof event.taskToken !== "string" || event.taskToken.length > 4096) throw new Error("Invalid workflow handoff");
      const { result: item } = await repository.mutate(store => {
        const item = store.cases.find(item => item.caseId === id); if (!item) throw new Error("Case not found");
        if (actor === "STAFF" && item.agent?.status === "RUNNING") completeCaseInvestigation(store, id, { error: "Cloud investigation did not finish before staff handoff" }, { provider: "BEDROCK" });
        if (actor === "STAFF" && item.status === "WAITING_CUSTOMER") {
          item.status = "OPEN_STAFF"; item.nextAction = "STAFF_HITL"; item.reason = "Customer confirmation timed out; staff review required";
          store.shelf.fsmState = "WAITING_STAFF";
          addAuditEntry(store, "CUSTOMER_CONFIRM_TIMEOUT", "WORKFLOW", { caseId: id });
        }
        return item;
      });
      if (item.status === "CLOSED" || (actor === "CUSTOMER" && item.status === "OPEN_STAFF")) { await services.resume(event.taskToken, { caseId: id, nextAction: item.nextAction }); return { delivered: true }; }
      await services.put({ id: tokenKey(id, actor), caseId: id, actor: actor.toLowerCase(), taskToken: event.taskToken, expiresAt: Math.floor(Date.now() / 1000) + (actor === "CUSTOMER" ? 115 : 86395), ttl: Math.floor(Date.now() / 1000) + 172800 });
      return { delivered: true };
    },

    async validate(event) {
      const id = caseId(event.caseId);
      return repository.mutate(store => {
        const item = store.cases.find(item => item.caseId === id);
        if (!item || item.status !== "CLOSED" || !item.resolution) throw new Error("No validated human resolution; cart remains guarded");
        addAuditEntry(store, "CASE_WORKFLOW_COMPLETED", "STEP_FUNCTIONS", { caseId: id, resolution: item.resolution });
        return { caseId: id, valid: true };
      }).then(value => value.result);
    },

    async reconcile() {
      const store = await repository.read();
      for (const item of store.cases) if (store.cloudWorkflows?.[item.caseId]?.launched === false) await launch(item);
      const tokens = await services.scan(item => item.id.startsWith("HITL#") && !item.completed);
      for (const token of tokens) await resumeDecision(token.caseId, token.actor);
      return { ok: true };
    },

    async websocket(event) {
      try {
        if (event.requestContext.routeKey === "$connect") await services.connect(event.queryStringParameters?.ticket, event.requestContext.connectionId);
        else if (event.requestContext.routeKey === "$disconnect") await services.disconnect(event.requestContext.connectionId);
        return { statusCode: 200, body: "ok" };
      } catch { return { statusCode: 401, body: "Invalid or expired connection ticket" }; }
    },
    async changes() { await services.broadcast(); return { ok: true }; },
    async archive(event) { await services.archive(event.Records || []); return { ok: true }; },
    async retention() { await services.retention(); return { ok: true }; },
  };
}

let handlers;
const call = name => async event => { handlers ||= createCloudHandlers(createCloudServices()); return handlers[name](event); };
export const api = call("api"), ingest = call("ingest"), investigate = call("investigate"), handoff = call("handoff"), validate = call("validate"), reconcile = call("reconcile"), websocket = call("websocket"), changes = call("changes"), archive = call("archive"), retention = call("retention");
