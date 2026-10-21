import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrototypeApplication } from "../src/application.mjs";
import { requestJevBasketDecision } from "../src/agent/jev.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";

test("Jev provider sends a typed basket choice and parses its confidence", async () => {
  let request;
  const result = await requestJevBasketDecision({
    context: { event: { eventType: "PICK", sku: "COKE" } },
    apiKey: "test-secret",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            model: "jev-latest",
            answers: { basket: { type: "choice", choice: "A", confidence: 0.9, probabilities: { A: 0.9, B: 0.05, NONE: 0.05 } } },
            usage: { input_tokens: 100, output_tokens: 8 },
          };
        },
      };
    },
  });

  assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer test-secret");
  assert.equal(JSON.parse(request.options.body).questions.basket.type, "choice");
  assert.deepEqual(result, {
    candidate: "A",
    confidence: 0.9,
    model: "jev-latest",
    usage: { input_tokens: 100, output_tokens: 8 },
  });
});

test("Jev provider requires a key and rejects malformed model responses", async () => {
  await assert.rejects(requestJevBasketDecision({ context: {}, apiKey: "", fetchImpl: async () => { throw new Error("should not call"); } }), /TYPESAFE_API_KEY/);
  await assert.rejects(requestJevBasketDecision({
    context: {},
    apiKey: "test-secret",
    fetchImpl: async () => ({ ok: true, async json() { return { answers: { basket: { type: "choice", choice: "OTHER", confidence: 0.9 } } }; } }),
  }), /invalid basket decision/);
});

test("local Jev recommendation can ask the customer, but only after deterministic guards", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-basket-jev-"));
  try {
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    const application = createPrototypeApplication({
      repository,
      agentProvider: "jev",
      jevDecision: async ({ context }) => {
        assert.equal(context.evidence.candidate, "A");
        return { candidate: "A", confidence: 0.9, model: "jev-latest", usage: { input_tokens: 100, output_tokens: 8 } };
      },
      logger: () => {},
    });
    await application.init();
    await application.startSession("A");

    const result = await application.processShelfEvent({
      eventId: "jev-customer-confirm-001",
      shelfId: "SHELF-01",
      laneId: "LANE-1",
      eventType: "PICK",
      rssi: { A: -55, B: -57 },
    });
    const state = await application.getState();
    const caseItem = state.cases.find((item) => item.caseId === result.caseId);

    assert.equal(result.nextAction, "CUSTOMER_CONFIRM");
    assert.equal(caseItem.agent.provider, "JEV");
    assert.equal(caseItem.agent.output.model, "jev-latest");
    assert.equal(caseItem.toolCalls.length, 3);
    assert.ok(state.auditLog.some((entry) => entry.actor === "JEV_AGENT" && entry.action === "AGENT_RECOMMENDATION"));
    assert.equal(state.baskets.find((basket) => basket.basketId === "A").total, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local Jev recommendation that conflicts with RSSI is routed to staff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-basket-jev-"));
  try {
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    const application = createPrototypeApplication({
      repository,
      agentProvider: "jev",
      jevDecision: async () => ({ candidate: "B", confidence: 0.99, model: "jev-latest" }),
      logger: () => {},
    });
    await application.init();
    await application.startSession("A");
    await application.startSession("B");

    const result = await application.processShelfEvent({
      eventId: "jev-rssi-conflict-001",
      shelfId: "SHELF-01",
      laneId: "LANE-1",
      eventType: "PICK",
      rssi: { A: -55, B: -57 },
    });
    const caseItem = (await application.getState()).cases.find((item) => item.caseId === result.caseId);

    assert.equal(result.nextAction, "STAFF_HITL");
    assert.match(caseItem.reason, /disagrees with the nearest RSSI candidate/);
    assert.equal(caseItem.status, "OPEN_STAFF");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
