import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createStore, startSession, processShelfEvent } from "../src/domain.mjs";
import { ingestTelemetry, ingestCameraEvidence } from "../src/evidence.mjs";
import { runAgentTool } from "../src/agent/tools.mjs";
import { requestLayaToolDecision } from "../src/agent/laya.mjs";
import { runAgentInvestigation } from "../src/agent/agent-loop.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { forwardTelemetry } from "../tools/mqtt-broker/forward-event.mjs";

const event = { eventId: "agentic-event", shelfId: "SHELF-01", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } };
async function fixture(work) {
  const directory = await mkdtemp(join(tmpdir(), "agentic-evidence-"));
  try {
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    await repository.init();
    await repository.mutate(store => {
      startSession(store, "A"); startSession(store, "B");
      return processShelfEvent(store, event);
    });
    await work(repository);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("Evidence ingestion normalizes firmware telemetry, bounds history and labels missing/camera evidence", () => {
  const store = createStore(); startSession(store, "A"); processShelfEvent(store, event);
  assert.equal(runAgentTool(store, "get_signal_window", { eventId: event.eventId }).status, "NO_DATA");
  assert.equal(runAgentTool(store, "get_device_health", { eventId: event.eventId }).status, "UNKNOWN");
  const input = { shelfId: "SHELF-01", uptime: 10, baskets: { A: -55, B: -57 }, queueDepth: 0, droppedEvents: 0 };
  const sample = ingestTelemetry(store, input);
  assert.equal(sample.uptimeMs, 10000); assert.equal(sample.timeBasis, "SERVER_RECEIPT");
  ingestTelemetry(store, { shelfId: "SHELF-01", uptimeMs: 11000, rssi: event.rssi, lanes: [{ laneId: "LANE-1", present: false }], source: "MOCK" });
  assert.equal(runAgentTool(store, "get_lane_state", { eventId: event.eventId }).sample.present, false);
  assert.throws(() => ingestTelemetry(store, { ...input, baskets: { A: 10 } }), /RSSI/);
  assert.throws(() => runAgentTool(store, "constructor"), /Unknown/);
  ingestCameraEvidence(store, { eventId: event.eventId, cameraId: "CAM-1", source: "MOCK", capturedAt: store.events[0].timestamp, observations: ["OCCLUDED"] });
  const camera = runAgentTool(store, "get_camera_evidence", { eventId: event.eventId });
  assert.equal(camera.observations[0].source, "MOCK"); assert.equal(camera.observations[0].aligned, false, "Receipt-time shelf events cannot prove capture-time alignment");
  for (let i = 0; i < 125; i++) ingestTelemetry(store, input);
  assert.equal(store.telemetry.length, 120);
});

test("Laya selects from dynamic action criteria and validates the selected probability", async () => {
  let body;
  const result = await requestLayaToolDecision({ context: { missingCoreEvidence: ["get_shelf_event"] }, actions: [{ id: "get_shelf_event", description: "Read event" }, { id: "get_signal_window", description: "Read RSSI history" }], fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ model: "actual-provider-contract-fixture", answers: { next_action: { type: "choice", choice: "get_signal_window", probabilities: { get_shelf_event: 0.2, get_signal_window: 0.8 } } } }) };
  } });
  assert.equal(result.action, "get_signal_window"); assert.equal(result.confidence, 0.8);
  assert.deepEqual(Object.keys(body.questions.next_action.criteria), ["get_shelf_event", "get_signal_window"]);
});

test("Agent follows model-selected orders instead of a fixed tool sequence and persists observations", async () => {
  for (const sequence of [["get_cart_history", "get_shelf_event", "get_basket_evidence", "DECIDE"], ["get_device_health", "get_basket_evidence", "get_cart_history", "get_shelf_event", "analyze_cart_consistency", "DECIDE"]]) {
    await fixture(async repository => {
      const selected = [];
      const planner = async ({ actions, context }) => {
        const action = sequence[selected.length];
        assert.ok(actions.some(item => item.id === action), action);
        assert.equal(context.observations.length, selected.length);
        selected.push(action);
        return { action, model: "fixture-planner", confidence: 0.9 };
      };
      const { result, store } = await runAgentInvestigation(repository, "CASE-001", { provider: "LAYA", planner, decision: async () => ({ candidate: "A", confidence: 0.9, model: "fixture-decision" }) });
      assert.equal(result.status, "WAITING_CUSTOMER"); assert.equal(result.agent.mode, "AGENTIC");
      assert.deepEqual(result.agent.steps.filter(step => step.phase === "SELECT").map(step => step.action), sequence);
      assert.deepEqual(store.carts, { A: {}, B: {} });
      assert.equal(store.auditLog.filter(item => item.action === "AGENT_ACTION_SELECTED").length, sequence.length);
      const reloaded = new LocalJsonRepository(repository.path); await reloaded.init();
      assert.equal((await reloaded.read()).cases[0].agent.steps.length, result.agent.steps.length);
    });
  }
});

test("Agent-selected RSSI script can veto a confident model recommendation when observations conflict", async () => {
  await fixture(async repository => {
    await repository.mutate(store => {
      for (let i = 0; i < 4; i++) ingestTelemetry(store, { shelfId: "SHELF-01", source: "MOCK", rssi: i % 2 ? { A: -48, B: -73 } : { A: -73, B: -48 } });
    });
    const sequence = ["get_signal_window", "analyze_rssi_stability", "get_shelf_event", "get_basket_evidence", "get_cart_history", "DECIDE"];
    let index = 0;
    const { result, store } = await runAgentInvestigation(repository, "CASE-001", { provider: "LAYA", planner: async () => ({ action: sequence[index++], model: "fixture" }), decision: async () => ({ candidate: "A", confidence: 0.99 }) });
    assert.equal(result.status, "OPEN_STAFF"); assert.match(result.reason, /fluctuates/);
    assert.equal(result.toolCalls.find(call => call.name === "run_evidence_analysis").input.scriptId, "rssi_stability");
    assert.deepEqual(store.carts, { A: {}, B: {} });
  });
});

test("Agent can stop after unavailable evidence; no forced fallback tools or decision inference", async () => {
  await fixture(async repository => {
    let index = 0;
    const sequence = ["get_camera_evidence", "STOP_STAFF"];
    const { result } = await runAgentInvestigation(repository, "CASE-001", { provider: "LAYA", planner: async ({ context }) => {
      if (index) assert.match(context.observations[0].summary, /NO_DATA/);
      return { action: sequence[index++], model: "fixture" };
    }, decision: async () => { throw new Error("Must not run"); } });
    assert.equal(result.agent.status, "COMPLETED"); assert.equal(result.status, "OPEN_STAFF");
    assert.deepEqual(result.toolCalls.map(call => call.name), ["get_camera_evidence"]);
  });
});

test("Invalid planner action, step budget and deadline all preserve carts and route to staff", async () => {
  for (const mode of ["invalid", "budget", "deadline"]) await fixture(async repository => {
    const { result, store } = await runAgentInvestigation(repository, "CASE-001", { provider: "LAYA", maxSteps: 2, timeoutMs: mode === "deadline" ? 10 : 25000, planner: async ({ actions }) => {
      if (mode === "deadline") await delay(30);
      return { action: mode === "invalid" ? "exec_shell" : actions[0].id, model: "fixture" };
    }, decision: async () => { throw new Error("Must not run"); } });
    assert.equal(result.status, "OPEN_STAFF"); assert.deepEqual(store.carts, { A: {}, B: {} });
    assert.match(result.reason, mode === "invalid" ? /unavailable/ : mode === "budget" ? /budget/ : /deadline/);
  });
});

test("Telemetry forwarder enforces topic identity, posts to the collector and never invents an ACK", async () => {
  let requested;
  const ok = await forwardTelemetry(Buffer.from(JSON.stringify({ shelfId: "SHELF-01", rssi: event.rssi })), { shelfId: "SHELF-01", apiOrigin: "http://localhost:3000/api/events", fetchImpl: async (url, init) => { requested = { url: String(url), body: JSON.parse(init.body) }; return { ok: true }; } });
  assert.equal(ok, true); assert.equal(requested.url, "http://localhost:3000/api/telemetry");
  const rejected = await forwardTelemetry(Buffer.from('{"shelfId":"OTHER"}'), { shelfId: "SHELF-01", apiOrigin: "http://localhost:3000", fetchImpl: async () => { throw new Error("Must not call"); }, log: () => {} });
  assert.equal(rejected, false);
});
