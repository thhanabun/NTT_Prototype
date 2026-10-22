import { investigateStoredCase } from "./agent/investigate-stored-case.mjs";
import { requestJevBasketDecision } from "./agent/jev.mjs";
import { requestLayaBasketDecision } from "./agent/laya.mjs";
import { logEvent } from "./logger.mjs";
import { ingestTelemetry, ingestCameraEvidence } from "./evidence.mjs";
import { queryStatistics, planStatsQuery } from "./stats-query.mjs";
import {
  checkout,
  addAuditEntry,
  createStore,
  customerDecision,
  processShelfEvent,
  snapshot,
  staffDecision,
  startSession,
} from "./domain.mjs";

export function createPrototypeApplication({
  repository,
  onStateChange = () => {},
  logger = logEvent,
  agentProvider = process.env.AGENT_PROVIDER || "mock",
  jevDecision = requestJevBasketDecision,
  layaDecision = requestLayaBasketDecision,
  agentPlanner,
  statsPlanner = planStatsQuery,
}) {
  if (!repository) throw new Error("repository is required");
  const selectedAgentProvider = String(agentProvider).toLowerCase();
  if (!["mock", "jev", "laya"].includes(selectedAgentProvider)) throw new Error("AGENT_PROVIDER must be mock, jev or laya");
  let store = null;

  function notifyStateChange() {
    onStateChange(snapshot(store));
  }

  return {
    async init() {
      store = await repository.init();
      return snapshot(store);
    },

    getSnapshot() {
      if (!store) throw new Error("Prototype application has not been initialized");
      return snapshot(store);
    },

    async getState() {
      store = await repository.read();
      return snapshot(store);
    },

    async getAudit({ caseId, eventId, limit = 100 } = {}) {
      store = await repository.read();
      const count = Math.min(200, Math.max(1, Number(limit) || 100));
      const items = (store.auditLog || []).filter((entry) =>
        (!caseId || entry.details?.caseId === caseId) && (!eventId || entry.details?.eventId === eventId),
      ).slice(0, count);
      return { items };
    },

    async queryStatistics(input) {
      const response = await queryStatistics(repository, input, { planner: statsPlanner });
      const { store: next } = await repository.mutate(draft => addAuditEntry(draft, "STAT_QUERY_COMPLETED", "STAFF", {
        queryId: response.queryId, source: response.source, plan: response.plan, model: response.model.name, matchedOrders: response.result.totals.orderCount,
      }));
      store = next;
      logger("INFO", "STAT_QUERY_COMPLETED", { queryId: response.queryId, source: response.source, tool: response.plan.tool });
      notifyStateChange();
      return response;
    },

    async startSession(basketId) {
      const { result, store: next } = await repository.mutate((draft) => startSession(draft, basketId));
      store = next;
      logger("INFO", "SESSION_STARTED", { basketId: result.basketId, sessionId: result.sessionId });
      notifyStateChange();
      return result;
    },

    async ingestEvidence(kind, input) {
      const ingest = kind === "telemetry" ? ingestTelemetry : kind === "camera" ? ingestCameraEvidence : null;
      if (!ingest) throw new Error("Unknown evidence kind");
      const { result, store: next } = await repository.mutate(draft => ingest(draft, input));
      store = next;
      logger("INFO", "EVIDENCE_RECEIVED", { kind, shelfId: result.shelfId, source: result.source });
      return { ok: true };
    },

    async processShelfEvent(input) {
      const { result, store: next } = await repository.mutate((draft) => {
        const result = processShelfEvent(draft, input);
        // Bind mock imagery before investigation starts, without a camera-ingestion race.
        if (!result.duplicate && input.mockVisionFrameId !== undefined) ingestCameraEvidence(draft, {
          eventId: input.eventId, cameraId: "MOCK-YOLO", source: "MOCK", frameId: input.mockVisionFrameId, observations: ["INCONCLUSIVE"],
        });
        return result;
      });
      store = next;
      if (!result.duplicate && result.caseId) {
        const pendingCase = store.cases.find((item) => item.caseId === result.caseId);
        if (pendingCase?.type.startsWith("AMBIGUOUS_")) {
          const { result: caseItem, store: completedStore } = await investigateStoredCase(repository, result.caseId, {
            provider: selectedAgentProvider,
            decision: selectedAgentProvider === "laya" ? layaDecision : jevDecision,
            planner: selectedAgentProvider === "laya" ? agentPlanner : undefined,
            onStarted: (startedStore) => {
              store = startedStore;
              notifyStateChange();
            },
          });
          store = completedStore;
          result.nextAction = caseItem.nextAction;
          result.candidate = caseItem.candidate;
          result.confidence = caseItem.confidence;
          logger("INFO", "AGENT_CASE_RESULT", {
            caseId: caseItem.caseId,
            provider: caseItem.agent?.provider,
            status: caseItem.agent?.status,
            candidate: caseItem.candidate,
            confidence: caseItem.confidence,
            nextAction: caseItem.nextAction,
            toolCalls: caseItem.toolCalls?.map((tool) => tool.name) || [],
          });
        }
      }
      logger("INFO", "SHELF_EVENT_PROCESSED", {
        eventId: result.event?.eventId || result.eventId,
        disposition: result.disposition || (result.duplicate ? "DUPLICATE" : "UNKNOWN"),
        caseId: result.caseId || null,
        basketId: result.basketId || null,
      });
      if (!result.duplicate || result.auditOnly) notifyStateChange();
      return result;
    },

    async decideCase(caseId, actor, body = {}) {
      const { result, store: next } = await repository.mutate((draft) => {
        if (actor === "customer") return customerDecision(draft, caseId, String(body.answer || "").toUpperCase());
        if (actor === "staff") {
          return staffDecision(
            draft,
            caseId,
            String(body.decision || "").toUpperCase(),
            String(body.basketId || "").toUpperCase(),
          );
        }
        throw new Error("actor must be customer or staff");
      });
      store = next;
      logger("INFO", "HUMAN_CASE_DECISION", {
        caseId,
        actor: result.resolution?.actor,
        decision: result.resolution?.decision,
        status: result.status,
        basketId: result.resolution?.basketId || null,
      });
      notifyStateChange();
      return result;
    },

    async checkout(basketId) {
      const { result, store: next } = await repository.mutate((draft) => checkout(draft, basketId));
      store = next;
      logger("INFO", "MOCK_CHECKOUT_COMPLETED", {
        orderId: result.orderId,
        basketId: result.basketId,
        total: result.total,
      });
      notifyStateChange();
      return result;
    },

    async reset() {
      const { store: next } = await repository.replace(createStore());
      store = next;
      logger("INFO", "DEMO_STATE_RESET");
      notifyStateChange();
    },
  };
}
