import { createRepository } from "../../src/store-repository.mjs";
import { investigateStoredCase } from "../../src/agent/investigate-stored-case.mjs";
import { requestLayaBasketDecision, requestLayaToolDecision } from "../../src/agent/laya.mjs";

let repository;

function getRepository() {
  repository ||= createRepository({
    backend: "dynamodb",
    tableName: process.env.DYNAMODB_TABLE_NAME,
  });
  return repository;
}

export function createCaseManagerHandler({
  getStore = () => getRepository(),
  agentProvider = process.env.AGENT_PROVIDER || "laya",
  decision = requestLayaBasketDecision,
  planner = process.env.AGENT_MODE === "workflow" ? undefined : requestLayaToolDecision,
} = {}) {
  return async function handler(event) {
    const caseId = event?.caseId || event?.Payload?.caseId;
    if (!caseId) throw new Error("caseId is required");
    const { result: caseItem } = await investigateStoredCase(getStore(), caseId, { provider: agentProvider, decision, planner });
    const result = {
      caseId: caseItem.caseId,
      status: caseItem.status,
      candidate: caseItem.candidate,
      confidence: caseItem.confidence,
      nextAction: caseItem.nextAction,
      proposedAction: caseItem.proposedAction,
      reason: caseItem.reason,
      toolCalls: caseItem.toolCalls.map(({ name, status, summary }) => ({ name, status, summary })),
      agent: caseItem.agent,
    };
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      event: "AGENT_CASE_INVESTIGATED",
      ...result,
    }));
    return result;
  };
}

export const handler = createCaseManagerHandler();
