import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, processShelfEvent } from "../src/domain.mjs";
import { ingestCameraEvidence } from "../src/evidence.mjs";
import { inspectVisionEvidence } from "../src/agent/vision.mjs";
import { createPrototypeApplication } from "../src/application.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { createAgentToolsHandler } from "../infra/lambda/agent-tools.mjs";

const event = { eventId: "vision-001", shelfId: "SHELF-01", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } };
const output = { status: "AVAILABLE", model: "yolo11n", frameId: "demo-people", source: "MOCK", weightsSha256: "a".repeat(64), frameSha256: "b".repeat(64), imageSize: { width: 1280, height: 720 }, inferenceMs: 80, detections: [{ classId: 0, label: "person", confidence: 0.99, box: [1, 2, 100, 200] }] };
function fixture() {
  const store = createStore();
  processShelfEvent(store, event);
  ingestCameraEvidence(store, { eventId: event.eventId, cameraId: "CAM-1", source: "CAMERA", frameId: "demo-people", observations: ["INCONCLUSIVE"] });
  return store;
}

test("Vision adapter runs inference by registered ID and retains authoritative MOCK provenance without cart writes", async () => {
  const store = fixture();
  const before = structuredClone(store);
  const result = await inspectVisionEvidence(store, { eventId: event.eventId }, { fetchImpl: async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { frameId: "demo-people" });
    return { ok: true, json: async () => output };
  } });
  assert.equal(result.status, "AVAILABLE"); assert.equal(result.frames[0].source, "MOCK");
  assert.equal(result.frames[0].aligned, false); assert.equal(result.frames[0].detections[0].confidence, 0.99);
  assert.match(result.limitation, /not basket confidence/); assert.deepEqual(store, before);
  assert.throws(() => ingestCameraEvidence(store, { eventId: event.eventId, cameraId: "CAM-1", source: "MOCK", frameId: "../../secret.jpg", observations: ["INCONCLUSIVE"] }), /frameId/);
});

test("Missing, unavailable or invalid vision never produces fabricated detections", async () => {
  const store = fixture();
  const empty = { ...store, cameraEvidence: [] };
  assert.equal((await inspectVisionEvidence(empty, { eventId: event.eventId }, { fetchImpl: async () => { throw new Error("Must not fetch"); } })).status, "NO_DATA");
  for (const bad of [null, { ...output, source: "UNKNOWN" }, { ...output, frameId: "other" }, { ...output, detections: [{ ...output.detections[0], confidence: 2 }] }, { ...output, detections: [{ ...output.detections[0], box: [-1, 0, 1, 1] }] }]) {
    const result = await inspectVisionEvidence(store, { eventId: event.eventId }, { fetchImpl: async () => ({ ok: true, json: async () => bad }) });
    assert.equal(result.status, "UNAVAILABLE"); assert.deepEqual(result.frames, []);
  }
  assert.equal((await inspectVisionEvidence(store, { eventId: event.eventId }, { fetchImpl: async () => { throw new Error("offline"); } })).status, "UNAVAILABLE");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectVisionEvidence(store, { eventId: event.eventId }, { signal: controller.signal, fetchImpl: async () => { throw new Error("aborted"); } }), /abort/i);
});

test("Application atomically links mock image before Agent selection; async vision and Lambda results persist without charging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basket-vision-"));
  const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(output)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.VISION_ENDPOINT;
  process.env.VISION_ENDPOINT = `http://127.0.0.1:${server.address().port}/infer`;
  try {
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    const sequence = ["inspect_vision_evidence", "get_shelf_event", "get_basket_evidence", "get_cart_history", "DECIDE"];
    let index = 0;
    const app = createPrototypeApplication({ repository, logger: () => {}, agentProvider: "laya", agentPlanner: async ({ context, actions }) => {
      assert.equal(context.task.visionFrames[0].source, "MOCK");
      const action = sequence[index++]; assert.ok(actions.some(item => item.id === action));
      return { action, model: "fixture-planner" };
    }, layaDecision: async ({ context }) => {
      assert.match(context.investigation[0].summary, /MOCK/);
      return { candidate: "A", confidence: 0.5, model: "fixture-basket-model" };
    } });
    await app.init(); await app.startSession("A"); await app.startSession("B");
    const result = await app.processShelfEvent({ ...event, mockVisionFrameId: "demo-people" });
    let store = await repository.read();
    const item = store.cases[0];
    assert.equal(item.agent.status, "COMPLETED", JSON.stringify({ reason: item.reason, tools: item.toolCalls }));
    assert.equal(item.status, "OPEN_STAFF"); assert.equal(item.confidence, 0.5, "Object confidence cannot replace basket confidence");
    assert.deepEqual(store.carts, { A: {}, B: {} });
    assert.equal(item.toolCalls[0].result.frames[0].source, "MOCK");
    assert.ok(store.auditLog.some(entry => entry.action === "AGENT_TOOL_COMPLETED" && entry.details.tool === "inspect_vision_evidence"));
    await assert.rejects(app.checkout("A"), /pending/);
    const handler = createAgentToolsHandler({ tableName: "fixture-table", documentClient: { send: async () => ({ Item: { data: store } }) } });
    const response = await handler({ toolName: "inspect_vision_evidence", parameters: { eventId: event.eventId } });
    assert.equal(JSON.parse(response.response.functionResponse.responseBody.TEXT.body).frames[0].model, "yolo11n");
    await app.decideCase(result.caseId, "staff", { decision: "APPROVE", basketId: "A" });
    await app.processShelfEvent({ ...event, mockVisionFrameId: "demo-people" });
    store = await repository.read(); assert.equal(store.carts.A.COKE, 1); assert.equal(store.cameraEvidence.length, 1);
    const reopened = new LocalJsonRepository(repository.path); await reopened.init();
    assert.equal((await reopened.read()).cases[0].toolCalls[0].result.frames[0].detections[0].label, "person");
  } finally {
    if (previous === undefined) delete process.env.VISION_ENDPOINT; else process.env.VISION_ENDPOINT = previous;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
