import { runAgentTool } from "./tools.mjs";
import { requestLayaBasketDecision } from "./laya.mjs";

// Read-only tool for the orchestrator; cart writes remain in the validator.
export async function getBasketDecision(store, { eventId } = {}, decision = requestLayaBasketDecision) {
  const shelf = runAgentTool(store, "get_shelf_event", { eventId });
  const evidence = runAgentTool(store, "get_basket_evidence", { eventId });
  if (!shelf.found || evidence.zone !== "AMBIGUOUS") {
    return {
      candidate: null,
      confidence: 0,
      source: "POLICY",
      reason: "Model inference is allowed only for an existing ambiguous shelf event.",
    };
  }
  const assessment = await decision({
    context: { event: shelf.event, evidence, history: runAgentTool(store, "get_cart_history") },
  });
  return { ...assessment, source: "LAYA", requiresHumanConfirmation: true };
}
