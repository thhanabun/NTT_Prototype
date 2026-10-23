import { startCaseInvestigation, completeCaseInvestigation, recordAgentAction } from "./case-manager.mjs";
import { runAgentTool, TOOL_DESCRIPTIONS } from "./tools.mjs";
import { SCRIPT_DESCRIPTIONS } from "./analysis-scripts.mjs";

const REQUIRED = ["get_shelf_event", "get_basket_evidence", "get_cart_history"];
const SCRIPT_DEPENDENCIES = { rssi_stability: "get_signal_window", switch_bounce: "get_event_neighbors", cart_consistency: "get_cart_history" };

function availableActions(completed, cameraEvidence) {
  const actions = Object.entries(TOOL_DESCRIPTIONS).filter(([name]) => name !== "run_evidence_analysis" && !completed.has(name))
    .filter(([name]) => name !== "inspect_vision_evidence" || cameraEvidence.some(frame => frame.frameId))
    .filter(([name]) => name !== "get_camera_evidence" || cameraEvidence.length > 0)
    .map(([id, description]) => ({ id, description, tool: id }));
  for (const [scriptId, description] of Object.entries(SCRIPT_DESCRIPTIONS)) {
    const id = "analyze_" + scriptId;
    if (!completed.has(id) && completed.has(SCRIPT_DEPENDENCIES[scriptId])) actions.push({ id, description, tool: "run_evidence_analysis", scriptId });
  }
  if (REQUIRED.every(name => completed.has(name))) actions.push({ id: "DECIDE", description: "Core evidence collected. Ask the basket decision model, then apply policy and human confirmation." });
  if (completed.size) actions.push({ id: "STOP_STAFF", description: "Stop gathering evidence and ask staff because observations are inadequate or conflicting." });
  return actions;
}

function observationSummary(name, result) {
  if (name === "get_shelf_event") return JSON.stringify({ found: result.found, eventType: result.event?.eventType, delayed: result.event?.delayed });
  if (name === "get_cart_history") return JSON.stringify(result.baskets.map(item => ({ basket: item.basketId, active: Boolean(item.activeSession), cart: item.cart.map(line => ({ sku: line.sku, quantity: line.quantity })) })));
  if (name === "get_signal_window") return JSON.stringify({ status: result.status, sampleCount: result.samples.length, rssi: result.samples.slice(0, 4).map(item => ({ A: item.rssi.A, B: item.rssi.B })), timeBasis: result.timeBasis });
  if (name === "get_event_neighbors") return JSON.stringify({ eventCount: result.events.length, events: result.events.slice(0, 4).map(item => ({ type: item.eventType, receivedAt: item.receivedAt })), windowMs: result.windowMs });
  if (name === "get_camera_evidence") return JSON.stringify({ status: result.status, observations: result.observations.map(item => ({ source: item.source, aligned: item.aligned, observations: item.observations })) });
  if (name === "get_basket_evidence") return JSON.stringify({ zone: result.zone, rssi: result.rssi, candidate: result.candidate, active: result.activeSessions });
  if (name === "inspect_vision_evidence") return JSON.stringify({ status: result.status, ownership: "UNKNOWN", action: "UNKNOWN", frames: result.frames.map(frame => ({ source: frame.source, model: frame.model, objects: frame.detections.slice(0, 5).map(item => item.label) })) });
  return JSON.stringify(result).slice(0, 360);
}

async function withinDeadline(signal, operation) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(new Error("Agent investigation deadline exceeded")); signal.addEventListener("abort", onAbort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function runAgentInvestigation(repository, caseId, {
  provider, planner, decision, onStarted = () => {}, maxSteps = 8, timeoutMs = 25000, toolRunner = runAgentTool,
}) {
  if (typeof planner !== "function" || typeof decision !== "function" || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 8 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25000) throw new Error("Invalid Agent investigation configuration");
  const begun = await repository.mutate(draft => startCaseInvestigation(draft, caseId, { provider, collectEvidence: false }));
  if (begun.result.completed || begun.result.inProgress) return { result: begun.store.cases.find(item => item.caseId === caseId), store: begun.store };
  const investigationId = begun.result.investigationId;
  onStarted(begun.store);
  const completed = new Set();
  const observations = [];
  const signal = AbortSignal.timeout(timeoutMs);
  const deadlineAt = performance.now() + timeoutMs;
  let estimatedModelMs = 4000;
  let number = 0;

  function activeCase(store) {
    const item = store.cases.find(entry => entry.caseId === caseId);
    if (!item || item.agent?.investigationId !== investigationId || item.agent.status !== "RUNNING") throw new Error("Investigation is no longer active");
    return item;
  }
  async function persistStep(step) {
    const next = await repository.mutate(draft => recordAgentAction(draft, caseId, investigationId, step));
    onStarted(next.store);
  }
  async function finish(assessment) {
    const next = await repository.mutate(draft => {
      activeCase(draft);
      return completeCaseInvestigation(draft, caseId, assessment, { provider });
    });
    onStarted(next.store);
    return next;
  }

  try {
    for (number = 1; number <= maxSteps; number++) {
      const store = await repository.read();
      const item = activeCase(store);
      const cameraEvidence = (store.cameraEvidence || []).filter(frame => frame.eventId === item.eventId);
      const missingCoreEvidence = REQUIRED.filter(name => !completed.has(name));
      const remainingTimeMs = Math.max(0, Math.floor(deadlineAt - performance.now()));
      const remainingSteps = maxSteps - number + 1;
      let actions = availableActions(completed, cameraEvidence);
      // Reserve calls for missing core evidence and the final basket model, without fixing tool order.
      if (missingCoreEvidence.length && (remainingSteps <= missingCoreEvidence.length + 1 || remainingTimeMs <= (missingCoreEvidence.length + 2) * estimatedModelMs + 500)) {
        actions = actions.filter(action => missingCoreEvidence.includes(action.id) || action.id === "STOP_STAFF");
      }
      const budgetDecision = !missingCoreEvidence.length && (remainingSteps === 1 || remainingTimeMs <= estimatedModelMs * 2 + 500);
      const selectionStarted = performance.now();
      const selection = budgetDecision ? { action: "DECIDE" } : await withinDeadline(signal, () => planner({ signal, actions, context: {
        task: { type: item.type, eventType: item.eventType, sku: item.sku, visionFrames: (store.cameraEvidence || []).filter(frame => frame.eventId === item.eventId && frame.frameId).map(frame => ({ frameId: frame.frameId, source: frame.source })).slice(0, 2) },
        remainingSteps,
        remainingTimeMs,
        missingCoreEvidence,
        observations: observations.map(entry => ({ action: entry.action, summary: entry.summary.slice(0, 240) })),
      } }));
      const selectionDurationMs = Math.round(performance.now() - selectionStarted);
      if (!budgetDecision) estimatedModelMs = Math.max(estimatedModelMs, selectionDurationMs * 1.25);
      const action = actions.find(entry => entry.id === selection.action);
      if (!action) throw new Error("Planner selected an unavailable or repeated action");
      await persistStep({ number, phase: "SELECT", action: action.id, source: budgetDecision ? "POLICY" : "MODEL", summary: budgetDecision ? "Core evidence is complete; reserve the remaining budget for the basket decision model." : `Selected ${action.id}`, model: selection.model, confidence: selection.confidence, probabilities: selection.probabilities, durationMs: selectionDurationMs, remainingTimeMs: Math.max(0, Math.floor(deadlineAt - performance.now())), availableActions: actions.map(entry => entry.id) });
      if (action.id === "STOP_STAFF") return finish({ escalateReason: "The model stopped evidence collection and requested staff review." });
      if (action.id === "DECIDE") {
        const latest = activeCase(await repository.read());
        const calls = latest.toolCalls;
        const context = {
          case: { caseId, type: latest.type, proposedAction: latest.proposedAction },
          event: calls.find(call => call.name === "get_shelf_event")?.result.event,
          evidence: calls.find(call => call.name === "get_basket_evidence")?.result,
          history: calls.find(call => call.name === "get_cart_history")?.result,
          investigation: observations.slice(-4).map(entry => ({ action: entry.action, summary: entry.summary.slice(0, 180) })),
        };
        const assessment = await withinDeadline(signal, () => decision({ context, signal }));
        const evidenceIssues = latest.toolCalls.filter(call => call.result?.status === "CONFLICT" || (call.name === "get_device_health" && call.result.status === "DEGRADED"))
          .map(call => call.result.issue || `${call.name}: ${call.result.status}`);
        const camera = latest.toolCalls.find(call => call.name === "get_camera_evidence")?.result;
        if (camera?.observations.some(sample => sample.aligned && sample.source === "CAMERA" && sample.observations.includes(context.event.eventType === "PICK" ? "PUT_BACK_VISIBLE" : "PICK_VISIBLE"))) evidenceIssues.push("Aligned camera observation contradicts the shelf event");
        return finish({ ...assessment, evidenceIssues });
      }
      const input = action.tool === "get_cart_history" ? {} : { eventId: item.eventId, ...(action.scriptId ? { scriptId: action.scriptId } : {}) };
      let result;
      try { result = await withinDeadline(signal, async () => toolRunner(structuredClone(await repository.read()), action.tool, input, { signal })); }
      catch (error) {
        await persistStep({ number, phase: "OBSERVE", action: action.id, summary: error.message, toolCall: { name: action.tool, status: "ERROR", calledAt: new Date().toISOString(), input, result: { error: error.message }, summary: error.message } });
        throw error;
      }
      const summary = observationSummary(action.tool, result);
      await persistStep({ number, phase: "OBSERVE", action: action.id, summary, toolCall: { name: action.tool, status: "OK", calledAt: new Date().toISOString(), input, result, summary } });
      completed.add(action.id);
      observations.push({ action: action.id, summary });
    }
    return finish({ escalateReason: `Evidence collection reached its ${maxSteps}-step budget; staff review is required.` });
  } catch (error) {
    return finish({ error: `Agent investigation failed: ${error.message}` });
  }
}
