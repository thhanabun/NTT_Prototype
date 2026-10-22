import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPrototypeApplication } from "../src/application.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { requestLayaToolDecision } from "../src/agent/laya.mjs";
import { runAgentTool } from "../src/agent/tools.mjs";

const directory = resolve("data", "vision-verification-" + Date.now());
await mkdir(directory, { recursive: true });
const endpoint = process.env.VISION_ENDPOINT || "http://127.0.0.1:8001/infer";
const health = await (await fetch(new URL("/health", endpoint), { signal: AbortSignal.timeout(5000) })).json();
assert.equal(health.ready, true); assert.equal(health.model, "yolo11n");
for (const body of [{ frameId: "../../secret.jpg" }, { frameId: "https://example.com/image.jpg" }, { frameId: "demo-people", path: "secret" }]) {
  const rejected = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.equal(rejected.status, 400);
}
const report = { health, runs: [] };
for (const mode of ["FIXTURE_PLANNER_REAL_YOLO_REAL_DECISION", "REAL_PLANNER_REAL_YOLO_AVAILABLE"]) {
  const repository = new LocalJsonRepository(resolve(directory, mode + ".json"));
  const sequence = ["inspect_vision_evidence", "get_shelf_event", "get_basket_evidence", "get_cart_history", "DECIDE"];
  let index = 0;
  const app = createPrototypeApplication({ repository, agentProvider: "laya", logger: () => {},
    agentPlanner: mode.startsWith("FIXTURE") ? async () => ({ action: sequence[index++], model: "fixture-tool-selector" }) : requestLayaToolDecision });
  await app.init(); await app.startSession("A"); await app.startSession("B");
  const event = { eventId: "vision-" + mode, shelfId: "SHELF-01", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 }, mockVisionFrameId: "demo-people" };
  const result = await app.processShelfEvent(event);
  const beforeHuman = await repository.read();
  const item = beforeHuman.cases[0];
  if (mode.startsWith("FIXTURE") || item.agent.status !== "FAILED") assert.equal(item.agent.status, "COMPLETED", item.reason);
  else {
    // The live planner may need more CPU inference time than the bounded investigation permits.
    assert.match(item.reason, /deadline exceeded/); assert.equal(item.status, "OPEN_STAFF");
  }
  assert.deepEqual(beforeHuman.carts, { A: {}, B: {} });
  const vision = mode.startsWith("FIXTURE") ? item.toolCalls.find(call => call.name === "inspect_vision_evidence").result
    : await runAgentTool(beforeHuman, "inspect_vision_evidence", { eventId: event.eventId });
  assert.equal(vision.status, "AVAILABLE"); assert.equal(vision.frames[0].source, "MOCK");
  assert.ok(vision.frames[0].detections.some(item => item.label === "person"));
  await assert.rejects(app.checkout("A"), /pending/);
  await app.decideCase(result.caseId, "staff", { decision: "APPROVE", basketId: "A" });
  await app.processShelfEvent(event);
  assert.equal((await repository.read()).carts.A.COKE, 1);
  const order = await app.checkout("A"); assert.equal(order.total, 25);
  const persisted = new LocalJsonRepository(repository.path); await persisted.init();
  assert.equal((await persisted.read()).orders.length, 1);
  report.runs.push({ mode, actions: item.agent.steps.filter(step => step.phase === "SELECT").map(step => step.action),
    agentStatus: item.agent.status, reason: item.reason, candidate: item.candidate, basketConfidence: item.confidence,
    visionCalledByPlanner: item.toolCalls.some(call => call.name === "inspect_vision_evidence"),
    vision, cartBeforeHuman: beforeHuman.carts, checkout: order.total,
    auditToolCompletions: beforeHuman.auditLog.filter(entry => entry.action === "AGENT_TOOL_COMPLETED").length });
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(mode + ": " + report.runs.at(-1).actions.join(" -> ") + "; status=" + item.agent.status);
}
await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
console.log("Vision checks passed. Report: " + resolve(directory, "report.json"));
