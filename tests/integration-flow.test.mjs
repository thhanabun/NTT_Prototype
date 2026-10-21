import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrototypeApplication } from "../src/application.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { createValidatorHandler } from "../infra/lambda/validator.mjs";
import { forwardShelfEvent } from "../scripts/iot-bridge.mjs";

test("IoT bridge to cart: persists ambiguous event, runs tools, waits for HITL, validates and ignores redelivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-basket-integration-"));
  try {
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    let stateUpdates = 0;
    const application = createPrototypeApplication({
      repository,
      onStateChange: () => { stateUpdates += 1; },
      logger: () => {},
    });
    await application.init();
    await application.startSession("A");

    const payload = Buffer.from(JSON.stringify({
      eventId: "integration-ambiguous-001",
      shelfId: "SHELF-01",
      laneId: "LANE-1",
      eventType: "PICK",
      rssi: { A: -55, B: -57 },
    }));
    const acknowledgements = [];
    let responseBody;
    const fetchImpl = async (url, request) => {
      assert.equal(url.href, "http://prototype.local/api/events");
      assert.equal(request.method, "POST");
      responseBody = await application.processShelfEvent(JSON.parse(request.body));
      return { ok: true, status: 200 };
    };
    const ack = (eventId) => acknowledgements.push(eventId);

    assert.equal(await forwardShelfEvent(payload, {
      apiOrigin: "http://prototype.local",
      fetchImpl,
      publishAck: ack,
      log: () => {},
    }), true);
    assert.deepEqual(acknowledgements, ["integration-ambiguous-001"]);
    assert.equal(responseBody.nextAction, "CUSTOMER_CONFIRM");
    assert.equal(responseBody.confidence, 0.82);

    let state = await application.getState();
    let caseItem = state.cases.find((item) => item.caseId === responseBody.caseId);
    assert.equal(caseItem.toolCalls.length, 3);
    assert.equal(caseItem.agent.provider, "MOCK");
    assert.equal(state.baskets.find((basket) => basket.basketId === "A").total, 0);
    assert.equal(state.baskets.find((basket) => basket.basketId === "A").payable, false);

    await application.decideCase(caseItem.caseId, "customer", { answer: "YES" });
    const validator = createValidatorHandler({ getStore: () => repository });
    const validation = await validator({ caseId: caseItem.caseId });
    assert.equal(validation.valid, true);

    assert.equal(await forwardShelfEvent(payload, {
      apiOrigin: "http://prototype.local",
      fetchImpl,
      publishAck: ack,
      log: () => {},
    }), true);
    state = await application.getState();
    caseItem = state.cases.find((item) => item.caseId === responseBody.caseId);
    assert.equal(state.baskets.find((basket) => basket.basketId === "A").total, 25);
    assert.equal(state.baskets.find((basket) => basket.basketId === "A").payable, true);
    assert.deepEqual(acknowledgements, ["integration-ambiguous-001", "integration-ambiguous-001"]);
    assert.ok(state.auditLog.some((entry) => entry.action === "DUPLICATE_EVENT_IGNORED"));
    assert.ok(state.auditLog.some((entry) => entry.action === "CASE_VALIDATION_PASSED"));
    assert.equal(stateUpdates, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
