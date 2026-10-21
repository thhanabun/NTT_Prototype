import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { requestLayaBasketDecision } from "../src/agent/laya.mjs";
import { createPrototypeApplication } from "../src/application.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { createAgentToolsHandler } from "../infra/lambda/agent-tools.mjs";
import { investigateStoredCase } from "../src/agent/investigate-stored-case.mjs";

const payload = {
  model: "laya-typed-decisions",
  answers: {
    basket: { type: "choice", choice: "A", confidence: 0.42, probabilities: { A: 0.9, B: 0.04, NONE: 0.06 } },
  },
  usage: { input_tokens: 210, output_tokens: 0 },
};

test("Laya uses a bounded typed request and selected-option probability, not entropy confidence", async () => {
  let request;
  const result = await requestLayaBasketDecision({
    context: { event: { eventType: "PICK", sku: "COKE" }, history: { privateSessionDetails: "excluded" } },
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body), headers: options.headers };
      return { ok: true, json: async () => payload };
    },
  });
  assert.equal(request.url, "http://127.0.0.1:8000/v1/systemone");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.body.model, "typed-decisions");
  assert.equal(request.body.questions.basket.type, "choice");
  assert.ok(!JSON.stringify(request.body.state).includes("privateSessionDetails"));
  assert.equal(result.confidence, 0.9);
  assert.equal(result.confidenceSource, "selected_option_probability");
  assert.equal(result.candidate, "A");
});

test("Laya rejects malformed probability distributions", async () => {
  await assert.rejects(requestLayaBasketDecision({
    context: {},
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ answers: { basket: { type: "choice", choice: "A", probabilities: { A: 9, B: 0, NONE: 0 } } } }),
    }),
  }), /invalid basket probability/);
});

test("Laya transport, application policy and Bedrock tool share a read-only decision contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basket-laya-contract-"));
  try {
    let modelCalls = 0;
    const decision = (args) => requestLayaBasketDecision({
      ...args,
      fetchImpl: async () => { modelCalls++; return { ok: true, json: async () => payload }; },
    });
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    const app = createPrototypeApplication({ repository, agentProvider: "laya", layaDecision: decision, logger: () => {} });
    await app.init();
    await app.startSession("A");
    await app.processShelfEvent({ eventId: "clear", laneId: "LANE-1", eventType: "PICK", rssi: { A: -51, B: -72 } });
    assert.equal(modelCalls, 0);
    const input = { eventId: "ambiguous", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } };
    const result = await app.processShelfEvent(input);
    assert.equal(result.nextAction, "CUSTOMER_CONFIRM");
    const state = await app.getState();
    assert.equal(state.cases[0].agent.provider, "LAYA");
    assert.equal(state.cases[0].agent.output.probabilities.A, 0.9);
    assert.equal(state.baskets[0].total, 25);
    await app.processShelfEvent(input);
    assert.equal(modelCalls, 1);

    const store = await repository.read();
    const before = JSON.stringify(store.carts);
    const handler = createAgentToolsHandler({
      tableName: "local-contract",
      documentClient: { send: async () => ({ Item: { data: store } }) },
      decision,
    });
    const response = await handler({
      actionGroup: "SmartBasketEvidence",
      function: "get_basket_decision",
      parameters: [{ name: "eventId", value: "ambiguous" }],
    });
    const output = JSON.parse(response.response.functionResponse.responseBody.TEXT.body);
    assert.equal(output.source, "LAYA");
    assert.equal(output.confidence, 0.9);
    assert.equal(JSON.stringify(store.carts), before);
    assert.equal(modelCalls, 2);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Laya outage routes to staff without silently running the mock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basket-laya-outage-"));
  try {
    const app = createPrototypeApplication({
      repository: new LocalJsonRepository(join(directory, "state.json")),
      agentProvider: "laya",
      layaDecision: async () => { throw new Error("service unavailable"); },
      logger: () => {},
    });
    await app.init();
    await app.startSession("A");
    const result = await app.processShelfEvent({
      eventId: "outage", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 },
    });
    assert.equal(result.nextAction, "STAFF_HITL");
    const item = (await app.getState()).cases[0];
    assert.equal(item.agent.provider, "LAYA");
    assert.equal(item.agent.status, "FAILED");
    assert.equal(item.candidate, null);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("In-flight inference blocks human resolution and checkout; retries cannot reopen a closed failed case", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basket-laya-inflight-"));
  let release;
  let investigation;
  const blocked = new Promise((done) => { release = done; });
  let ready;
  const started = new Promise((done) => { ready = done; });
  try {
    let calls = 0;
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    const decision = async () => { calls++; ready(); await blocked; throw new Error("injected timeout"); };
    const app = createPrototypeApplication({ repository, agentProvider: "laya", layaDecision: decision, logger: () => {} });
    await app.init();
    await app.startSession("A");
    const input = { eventId: "inflight", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } };
    investigation = app.processShelfEvent(input);
    await started;
    const item = (await app.getState()).cases[0];
    assert.equal(item.agent.status, "RUNNING");
    assert.equal((await app.processShelfEvent(input)).duplicate, true);
    assert.equal(calls, 1);
    await assert.rejects(app.decideCase(item.caseId, "staff", { decision: "APPROVE", basketId: "A" }), /investigation.*progress/i);
    await assert.rejects(app.checkout("A"), /pending/i);
    release();
    await investigation;
    await app.decideCase(item.caseId, "staff", { decision: "REJECT" });
    const result = await investigateStoredCase(repository, item.caseId, { provider: "laya", decision });
    assert.equal(result.result.status, "CLOSED");
    assert.equal(calls, 1);
    assert.equal((await app.getState()).baskets[0].total, 0);
  } finally {
    release();
    await investigation;
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
