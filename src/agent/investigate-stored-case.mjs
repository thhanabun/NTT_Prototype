import { completeCaseInvestigation, investigateCase, startCaseInvestigation } from "./case-manager.mjs";
import { runAgentInvestigation } from "./agent-loop.mjs";

// Both the local app and cloud Lambda use this evidence -> inference -> policy path.
export async function investigateStoredCase(repository, caseId, {
  provider = "mock",
  decision,
  onStarted = () => {},
  planner,
} = {}) {
  const name = provider.toUpperCase();
  if (name === "MOCK") return repository.mutate((store) => investigateCase(store, caseId));
  if (typeof decision !== "function") throw new Error("A real decision provider is required");
  if (planner) return runAgentInvestigation(repository, caseId, { provider: name, planner, decision, onStarted });

  const { result: investigation, store } = await repository.mutate((draft) =>
    startCaseInvestigation(draft, caseId, { provider: name }));
  onStarted(store);
  if (investigation.completed || investigation.inProgress) {
    return { result: store.cases.find((item) => item.caseId === caseId), store };
  }

  let assessment = investigation;
  if (investigation.ready) {
    try {
      assessment = await decision({ context: investigation.context });
    } catch (error) {
      assessment = { error: name + " decision failed: " + error.message };
    }
  }
  return repository.mutate((draft) =>
    completeCaseInvestigation(draft, caseId, assessment, { provider: name }));
}
