import { addAuditEntry } from "../domain.mjs";
import { runAgentTool } from "./tools.mjs";

const AGENT_TOOL_SEQUENCE = ["get_shelf_event", "get_basket_evidence", "get_cart_history"];
const CUSTOMER_CONFIRM_THRESHOLD = 0.75;

function caseById(store, caseId) {
  const caseItem = store.cases.find((item) => item.caseId === caseId);
  if (!caseItem) throw new Error("Case not found");
  return caseItem;
}

function addCaseTimeline(caseItem, action, details = {}) {
  const entry = { at: new Date().toISOString(), action, ...details };
  caseItem.timeline.push(entry);
  caseItem.updatedAt = entry.at;
  return entry;
}

function summarizeToolResult(name, result) {
  if (name === "get_shelf_event") return result.found ? `event ${result.event.eventType} ${result.event.sku}` : "event not found";
  if (name === "get_basket_evidence") {
    return result.found
      ? `${result.zone}; candidate ${result.candidate || "none"}; margin ${result.marginDb ?? "unknown"} dB`
      : "evidence not found";
  }
  return result.baskets.map((basket) => `Basket ${basket.basketId}: ${basket.cart.length} SKU(s)`).join("; ");
}

function agentActor(provider) {
  return provider === "MOCK" ? "MOCK_AGENT" : `${provider}_AGENT`;
}

export function startCaseInvestigation(store, caseId, { provider = "MOCK" } = {}) {
  const caseItem = caseById(store, caseId);
  if (!caseItem.type.startsWith("AMBIGUOUS_")) throw new Error("Agent investigation is only for ambiguous cases");
  if (caseItem.status === "CLOSED" || caseItem.agent?.status === "COMPLETED") return { ready: false, completed: true, caseId };

  caseItem.agent = { provider, status: "RUNNING", startedAt: new Date().toISOString() };
  addCaseTimeline(caseItem, "AGENT_STARTED", { provider });
  addAuditEntry(store, "AGENT_STARTED", agentActor(provider), { caseId, eventId: caseItem.eventId });

  const toolResults = {};
  caseItem.toolCalls = [];
  try {
    for (const name of AGENT_TOOL_SEQUENCE) {
      const input = name === "get_cart_history" ? {} : { eventId: caseItem.eventId };
      const result = runAgentTool(store, name, input);
      const call = {
        name,
        status: "OK",
        calledAt: new Date().toISOString(),
        input,
        result,
        summary: summarizeToolResult(name, result),
      };
      caseItem.toolCalls.push(call);
      toolResults[name] = result;
      addCaseTimeline(caseItem, "AGENT_TOOL_COMPLETED", { tool: name, status: call.status });
      addAuditEntry(store, "AGENT_TOOL_COMPLETED", agentActor(provider), {
        caseId,
        eventId: caseItem.eventId,
        tool: name,
        status: call.status,
        summary: call.summary,
      });
    }
  } catch (error) {
    return { ready: false, caseId, error: `Agent investigation failed: ${error.message}` };
  }

  if (!toolResults.get_shelf_event.event || !toolResults.get_basket_evidence.found) {
    return {
      ready: false,
      caseId,
      error: "Agent tools could not find the source shelf event; staff review is required.",
    };
  }
  return {
    ready: true,
    caseId,
    context: {
      case: {
        caseId,
        type: caseItem.type,
        proposedAction: caseItem.proposedAction,
      },
      event: toolResults.get_shelf_event.event,
      evidence: toolResults.get_basket_evidence,
      history: toolResults.get_cart_history,
    },
  };
}

export function completeCaseInvestigation(store, caseId, assessment, { provider = "MOCK" } = {}) {
  const caseItem = caseById(store, caseId);
  if (caseItem.status === "CLOSED" || caseItem.agent?.status === "COMPLETED") return caseItem;

  const failToStaff = (reason, error = null) => {
    caseItem.candidate = null;
    caseItem.confidence = 0;
    caseItem.nextAction = "STAFF_HITL";
    caseItem.status = "OPEN_STAFF";
    caseItem.reason = reason;
    caseItem.agent = {
      ...caseItem.agent,
      provider,
      status: "FAILED",
      completedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    addCaseTimeline(caseItem, "AGENT_FAILED", { nextAction: "STAFF_HITL", reason });
    addAuditEntry(store, "AGENT_FAILED", agentActor(provider), { caseId, reason });
    store.shelf.fsmState = "WAITING_STAFF";
    return caseItem;
  };

  if (assessment?.error) return failToStaff(assessment.error, assessment.error);
  if (!assessment || !["A", "B", null].includes(assessment.candidate) ||
    !Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1) {
    return failToStaff("Agent returned an invalid recommendation; staff review is required.");
  }

  const event = caseItem.toolCalls.find((call) => call.name === "get_shelf_event")?.result.event;
  const evidence = caseItem.toolCalls.find((call) => call.name === "get_basket_evidence")?.result;
  const history = caseItem.toolCalls.find((call) => call.name === "get_cart_history")?.result;
  if (!event || !evidence?.found || !history?.baskets) {
    return failToStaff("Agent evidence is incomplete; staff review is required.");
  }

  const candidate = assessment.candidate;
  const confidence = candidate || provider === "MOCK" ? assessment.confidence : 0;
  const basketHistory = history.baskets.find((basket) => basket.basketId === candidate);
  const activeSession = Boolean(evidence.activeSessions[candidate]);
  const skuQuantity = basketHistory?.cart.find((line) => line.sku === caseItem.sku)?.quantity || 0;
  const putBackConflict = event.eventType === "PUT_BACK" && skuQuantity === 0;
  const delayed = event.delayed === true || evidence.zone === "DELAYED";
  const agreesWithRssi = candidate !== null && candidate === evidence.candidate;
  const nextAction = agreesWithRssi && activeSession && confidence >= CUSTOMER_CONFIRM_THRESHOLD && !putBackConflict && !delayed
    ? "CUSTOMER_CONFIRM"
    : "STAFF_HITL";

  caseItem.candidate = candidate;
  caseItem.confidence = confidence;
  caseItem.nextAction = nextAction;
  caseItem.status = nextAction === "CUSTOMER_CONFIRM" ? "WAITING_CUSTOMER" : "OPEN_STAFF";
  caseItem.evidence = {
    ...caseItem.evidence,
    rssi: evidence.rssi,
    marginDb: evidence.marginDb,
    zone: evidence.zone,
    activeSessions: evidence.activeSessions,
    cartQuantity: skuQuantity,
  };
  caseItem.reason = delayed
    ? "The shelf event was delayed; current BLE evidence may be stale, so staff review is required."
    : putBackConflict
      ? "The candidate basket has no confirmed quantity for this PUT_BACK; staff must resolve the cart conflict."
      : !candidate
        ? "The evidence does not distinguish a basket; staff review is required."
        : !agreesWithRssi
          ? "The agent recommendation disagrees with the nearest RSSI candidate; staff review is required."
          : !activeSession
            ? `Basket ${candidate} has no active shopper session; staff review is required.`
            : nextAction === "CUSTOMER_CONFIRM"
              ? "The agent found a likely basket and active session; customer confirmation is required before changing the cart."
              : "The recommendation does not meet the customer-confirmation confidence policy; staff review is required.";
  caseItem.agent = {
    provider,
    status: "COMPLETED",
    startedAt: caseItem.agent?.startedAt,
    completedAt: new Date().toISOString(),
    toolCallCount: caseItem.toolCalls.length,
    output: {
      candidate,
      confidence: assessment.confidence,
      nextAction,
      proposedAction: caseItem.proposedAction,
      ...(assessment.model ? { model: assessment.model } : {}),
      ...(assessment.probabilities ? { probabilities: assessment.probabilities } : {}),
      ...(assessment.confidenceSource ? { confidenceSource: assessment.confidenceSource } : {}),
      ...(assessment.requestDurationMs !== undefined ? { requestDurationMs: assessment.requestDurationMs } : {}),
      ...(assessment.routing ? { routing: assessment.routing } : {}),
      ...(assessment.usage ? { usage: assessment.usage } : {}),
    },
  };
  addCaseTimeline(caseItem, "AGENT_RECOMMENDATION", {
    candidate,
    confidence: assessment.confidence,
    nextAction,
    provider,
    ...(assessment.model ? { model: assessment.model } : {}),
  });
  addAuditEntry(store, "AGENT_RECOMMENDATION", agentActor(provider), {
    caseId,
    eventId: caseItem.eventId,
    candidate,
    confidence: assessment.confidence,
    nextAction,
    proposedAction: caseItem.proposedAction,
    ...(assessment.model ? { model: assessment.model } : {}),
  });
  store.shelf.fsmState = nextAction === "CUSTOMER_CONFIRM" ? "WAITING_CUSTOMER" : "WAITING_STAFF";
  return caseItem;
}

export function investigateCase(store, caseId, { mode = "MOCK" } = {}) {
  const investigation = startCaseInvestigation(store, caseId, { provider: mode });
  if (investigation.completed) return caseById(store, caseId);
  if (!investigation.ready) return completeCaseInvestigation(store, caseId, investigation, { provider: mode });

  const { evidence, event } = investigation.context;
  const candidate = evidence.candidate;
  const confidence = candidate ? Math.min(0.92, 0.72 + evidence.marginDb * 0.05) : 0.55;
  return completeCaseInvestigation(store, caseId, { candidate, confidence, event }, { provider: mode });
}
