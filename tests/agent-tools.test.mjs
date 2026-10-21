import test from "node:test";
import assert from "node:assert/strict";
import { createAgentToolsHandler } from "../infra/lambda/agent-tools.mjs";
import { createCaseManagerHandler } from "../infra/lambda/case-manager.mjs";
import { createAuditWriterHandler } from "../infra/lambda/audit-writer.mjs";
import { createValidatorHandler } from "../infra/lambda/validator.mjs";
import { createStore, customerDecision, processShelfEvent, startSession } from "../src/domain.mjs";
import { investigateCase } from "../src/agent/case-manager.mjs";

function ambiguousStore() {
  const store = createStore();
  startSession(store, "A");
  processShelfEvent(store, {
    eventId: "event-1",
    laneId: "LANE-1",
    eventType: "PICK",
    rssi: { A: -55, B: -57 },
  });
  return store;
}

test("Bedrock tools Lambda returns the function-details response and evidence", async () => {
  const store = ambiguousStore();
  const handler = createAgentToolsHandler({
    tableName: "smart-basket",
    documentClient: {
      async send(command) {
        assert.equal(command.input.Key.stateKey, "SMART_BASKET#STATE");
        return { Item: { data: store } };
      },
    },
  });

  const response = await handler({
    actionGroup: "SmartBasketEvidence",
    function: "get_basket_evidence",
    parameters: [{ name: "eventId", type: "string", value: "event-1" }],
    sessionAttributes: { caseId: "CASE-001" },
  });

  assert.equal(response.messageVersion, "1.0");
  assert.equal(response.response.actionGroup, "SmartBasketEvidence");
  assert.equal(response.response.function, "get_basket_evidence");
  const evidence = JSON.parse(response.response.functionResponse.responseBody.TEXT.body);
  assert.equal(evidence.candidate, "A");
  assert.equal(evidence.zone, "AMBIGUOUS");
  assert.deepEqual(response.sessionAttributes, { caseId: "CASE-001" });

  const shelfResponse = await handler({
    actionGroup: "SmartBasketEvidence",
    function: "get_shelf_event",
    parameters: [{ name: "eventId", type: "string", value: "event-1" }],
  });
  assert.equal(JSON.parse(shelfResponse.response.functionResponse.responseBody.TEXT.body).event.eventId, "event-1");

  const cartResponse = await handler({
    actionGroup: "SmartBasketEvidence",
    function: "get_cart_history",
    parameters: [],
  });
  assert.equal(JSON.parse(cartResponse.response.functionResponse.responseBody.TEXT.body).baskets.length, 2);
});

test("case manager Lambda calls mock tools and returns a customer confirmation recommendation", async () => {
  const store = ambiguousStore();
  const repository = {
    async mutate(mutator) {
      const result = mutator(store);
      return { result, store };
    },
  };
  const handler = createCaseManagerHandler({ getStore: () => repository, agentProvider: "mock" });
  const result = await handler({ caseId: "CASE-001" });

  assert.equal(result.candidate, "A");
  assert.equal(result.confidence, 0.82);
  assert.equal(result.nextAction, "CUSTOMER_CONFIRM");
  assert.equal(result.toolCalls.length, 3);
  assert.equal(result.agent.provider, "MOCK");
});

test("audit writer Lambda appends structured audit entries", async () => {
  const store = createStore();
  const repository = {
    async mutate(mutator) {
      const result = mutator(store);
      return { result, store };
    },
  };
  const handler = createAuditWriterHandler({ getStore: () => repository });
  const result = await handler({ action: "CASE_WORKFLOW_COMPLETED", actor: "STEP_FUNCTIONS", details: { caseId: "CASE-001" } });

  assert.equal(result.action, "CASE_WORKFLOW_COMPLETED");
  assert.equal(store.auditLog[0].auditId, result.auditId);
  assert.deepEqual(store.auditLog[0].details, { caseId: "CASE-001" });
});

test("validator Lambda keeps unresolved cases blocked and records a passed resolution", async () => {
  const store = ambiguousStore();
  const caseItem = investigateCase(store, "CASE-001");
  const repository = {
    async mutate(mutator) {
      const result = mutator(store);
      return { result, store };
    },
  };
  const handler = createValidatorHandler({ getStore: () => repository });

  const pending = await handler({ caseId: caseItem.caseId });
  assert.equal(pending.valid, false);
  assert.equal(pending.status, "WAITING_CUSTOMER");
  customerDecision(store, caseItem.caseId, "YES");
  const closed = await handler({ caseId: caseItem.caseId });
  assert.equal(closed.valid, true);
  assert.equal(closed.status, "CLOSED");
  assert.ok(store.auditLog.some((entry) => entry.action === "CASE_VALIDATION_PASSED"));
});
