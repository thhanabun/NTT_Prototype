import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Aedes } from "aedes";
import mqtt from "mqtt";
import { startIoTBridge } from "./iot-bridge.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { processShelfEvent, staffDecision, startSession } from "../src/domain.mjs";
import { requestLayaBasketDecision } from "../src/agent/laya.mjs";
import { createCaseManagerHandler } from "../infra/lambda/case-manager.mjs";
import { createAgentToolsHandler } from "../infra/lambda/agent-tools.mjs";
import { createValidatorHandler } from "../infra/lambda/validator.mjs";
import { createAuditWriterHandler } from "../infra/lambda/audit-writer.mjs";

// Real MQTT/TCP, HTTP, local DB, SSE and Laya. Only sensor inputs and human choices are scripted.
const modelEndpoint = process.env.LAYA_ENDPOINT || "http://127.0.0.1:8000/v1/systemone";
const modelHeaders = process.env.LAYA_API_KEY ? { authorization: "Bearer " + process.env.LAYA_API_KEY } : {};
const healthResponse = await fetch(new URL("/health", modelEndpoint), { headers: modelHeaders, signal: AbortSignal.timeout(5000) });
assert.ok(healthResponse.ok, "Start npm run model:laya before this integration check");
const health = await healthResponse.json();
await mkdir("data", { recursive: true });
const runDirectory = await mkdtemp(resolve("data/full-flow-"));
const statePath = join(runDirectory, "state.json");
const reportPath = resolve("data/full-flow-report.json");
const report = {
  startedAt: new Date().toISOString(), runDirectory, health,
  boundary: {
    simulated: ["ESP32 switch/BLE payloads", "customer/staff button decisions", "model 503/timeout and response-delay fault injection"],
    real: ["MQTT 3.1.1 over loopback TCP", "production IoT bridge", "HTTP compute/FSM", "Laya inference", "JSON persistence", "SSE clients", "Lambda handler code invoked locally"],
    notExercised: ["AWS IoT Core TLS/certificates/policies", "AWS Lambda runtime", "Step Functions execution/callback transport", "Bedrock orchestration", "live DynamoDB", "physical hardware", "browser rendering"],
  },
  checks: [], signalLatencies: [], modelCalls: [],
};
function passed(name, details = {}) {
  report.checks.push({ name, passed: true, ...details });
  console.log("PASS " + name);
}
async function waitFor(predicate, message, timeout = 12000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(20);
  }
  throw new Error("Timed out: " + message);
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
const broker = await Aedes.createBroker();
const mqttServer = tcpServer(broker.handle);
const mqttPort = await listen(mqttServer);
const brokerUrl = "mqtt://127.0.0.1:" + mqttPort;
let modelMode = "real";
const modelProxy = httpServer(async (request, response) => {
  const mode = modelMode;
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const started = performance.now();
    if (mode === "503") {
      report.modelCalls.push({ mode: "injected-outage", status: 503 });
      response.writeHead(503).end("intentional model outage");
      return;
    }
    if (mode === "timeout") {
      report.modelCalls.push({ mode: "injected-timeout", status: "no response before client deadline" });
      const timer = setTimeout(() => response.writeHead(504).end("intentional timeout"), 35000);
      timer.unref();
      response.on("close", () => clearTimeout(timer));
      return;
    }
    const upstream = await fetch(modelEndpoint, {
      method: "POST", headers: { ...modelHeaders, "content-type": "application/json" },
      body: Buffer.concat(chunks), signal: AbortSignal.timeout(35000),
    });
    const body = await upstream.text();
    const parsed = JSON.parse(body);
    report.modelCalls.push({ mode: "real", status: upstream.status, durationMs: Math.round(performance.now() - started), answer: parsed.answers?.basket, usage: parsed.usage });
    if (mode === "slow") await delay(6500);
    response.writeHead(upstream.status, { "content-type": "application/json" }).end(body);
  } catch (error) {
    response.writeHead(502).end(error.message);
  }
});
const proxyPort = await listen(modelProxy);
const probe = tcpServer();
const appPort = await listen(probe);
await new Promise((done) => probe.close(done));
const origin = "http://127.0.0.1:" + appPort;
let app;
let appLogs = "";
async function startApp() {
  app = spawn(process.execPath, ["src/server.mjs"], {
    cwd: resolve("."), windowsHide: true,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(appPort), STORE_BACKEND: "local", STORE_PATH: statePath, AGENT_PROVIDER: "laya", LAYA_ENDPOINT: "http://127.0.0.1:" + proxyPort + "/v1/systemone" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (chunk) => { appLogs += chunk; });
  app.stderr.on("data", (chunk) => { appLogs += chunk; });
  await waitFor(async () => {
    if (app.exitCode !== null) throw new Error("App exited: " + appLogs);
    try { return (await fetch(origin + "/api/state")).ok; } catch { return false; }
  }, "HTTP app ready");
}
async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const stopped = once(app, "exit");
  app.kill();
  await stopped;
}
async function api(path, body, expectedStatus) {
  const response = await fetch(origin + path, {
    ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (expectedStatus) assert.equal(response.status, expectedStatus, JSON.stringify(result));
  else assert.ok(response.ok, JSON.stringify(result));
  return result;
}
const streams = [];
async function subscribe(label) {
  const controller = new AbortController();
  const response = await fetch(origin + "/api/stream", { signal: controller.signal });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const frames = [];
  const reader = response.body.getReader();
  const task = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) frames.push({ at: performance.now(), state: JSON.parse(data.slice(6)) });
      }
    }
  })().catch((error) => { if (!controller.signal.aborted) throw error; });
  const stream = { label, controller, frames, task };
  streams.push(stream);
  await waitFor(() => frames.length, label + " initial stream state");
  return stream;
}
let bridge;
let hardware;
const acknowledgements = [];
const bridgeLogs = [];
const eventTopic = "smartbasket/shelf/SHELF-01/events";
const ackTopic = "smartbasket/shelf/SHELF-01/acks";
let sequence = 0;
function signal(rssi, eventType = "PICK", laneId = "LANE-1", extra = {}) {
  return { eventId: "full-" + (++sequence), shelfId: "SHELF-01", laneId, sku: laneId === "LANE-1" ? "COKE" : "WATER", eventType, timestamp: new Date().toISOString(), delayed: false, rssi, ...extra };
}
async function sendHardware(payload, { qos = 0 } = {}) {
  const before = acknowledgements.filter((item) => item.eventId === payload.eventId).length;
  const started = performance.now();
  await hardware.publishAsync(eventTopic, JSON.stringify(payload), { qos });
  await waitFor(() => acknowledgements.filter((item) => item.eventId === payload.eventId).length > before, "application ACK for " + payload.eventId);
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(persisted.seenEventIds.includes(payload.eventId), "ACK must follow persisted event ingestion");
  const state = await api("/api/state");
  const streamTimes = [];
  for (const stream of streams.filter((item) => !item.controller.signal.aborted)) {
    const frame = await waitFor(() => stream.frames.find((item) => item.at >= started && item.state.shelf.lastEventId === payload.eventId), stream.label + " event notification");
    streamTimes.push(Math.round(frame.at - started));
  }
  report.signalLatencies.push({ eventId: payload.eventId, eventType: payload.eventType, qos, ackMs: Math.round(performance.now() - started), firstStateNotificationMs: Math.max(0, ...streamTimes) });
  return { state, caseItem: state.cases.find((item) => item.eventId === payload.eventId) };
}
function totals(state) { return state.baskets.map((basket) => basket.total); }
function lineQuantity(state, basketId, sku) {
  return state.baskets.find((basket) => basket.basketId === basketId).lines.find((line) => line.sku === sku)?.quantity || 0;
}
async function rejectCase(caseItem) {
  const result = await api("/api/cases/" + caseItem.caseId + "/staff", { decision: "REJECT" });
  assert.equal(result.case.status, "CLOSED");
}

try {
  await startApp();
  const html = await (await fetch(origin)).text();
  assert.ok(html.includes('id="view-shopper"') && html.includes('id="view-staff"'));
  const shopper = await subscribe("shopper");
  const staff = await subscribe("staff");
  bridge = startIoTBridge({ brokerUrl, apiOrigin: origin, log: (...items) => bridgeLogs.push(items.join(" ")), logError: (...items) => bridgeLogs.push(items.join(" ")) });
  await waitFor(() => bridgeLogs.some((line) => line.includes("Subscribed")), "production bridge subscription");
  hardware = mqtt.connect(brokerUrl, { clientId: "simulated-esp32", protocolVersion: 4, reconnectPeriod: 100 });
  hardware.on("error", (error) => bridgeLogs.push("hardware: " + error.message));
  hardware.on("message", (topic, payload) => {
    if (topic === ackTopic) acknowledgements.push({ eventId: payload.toString(), at: performance.now() });
  });
  await once(hardware, "connect");
  await hardware.subscribeAsync(ackTopic, { qos: 1 });
  await api("/api/sessions", { basketId: "A" });
  await api("/api/sessions", { basketId: "B" });
  passed("Real MQTT broker, production bridge, HTTP app, two SSE subscribers and sessions ready");

  for (let cycle = 0; cycle < 30; cycle++) {
    const basketId = cycle % 2 ? "B" : "A";
    const laneId = cycle % 3 ? "LANE-1" : "LANE-2";
    const sku = laneId === "LANE-1" ? "COKE" : "WATER";
    const rssi = basketId === "A" ? { A: -51, B: -72 } : { A: -72, B: -51 };
    const pick = signal(rssi, "PICK", laneId);
    let { state } = await sendHardware(pick, { qos: cycle % 2 });
    assert.equal(lineQuantity(state, basketId, sku), 1);
    const duplicate = await sendHardware({ ...pick, delayed: true }, { qos: 1 });
    assert.deepEqual(totals(duplicate.state), totals(state));
    state = (await sendHardware(signal(rssi, "PUT_BACK", laneId))).state;
    assert.equal(lineQuantity(state, basketId, sku), 0);
    assert.deepEqual(totals(state), [0, 0]);
  }
  assert.equal(report.modelCalls.length, 0);
  passed("30 PICK/PUT_BACK cycles plus 30 duplicate retries: both baskets/products, zero negative or duplicate charges, no model calls", { cycles: 30, mqttSignals: 90 });

  await sendHardware(signal({ A: -51, B: -72 }));
  for (const [name, rssi, selected] of [["near-A", { A: -55, B: -57 }, "A"], ["near-B", { A: -57, B: -55 }, "B"], ["tie", { A: -56, B: -56 }, null]]) {
    const before = await api("/api/state");
    const payload = signal(rssi);
    const { state, caseItem } = await sendHardware(payload);
    assert.equal(caseItem.agent.provider, "LAYA");
    assert.equal(caseItem.agent.status, "COMPLETED");
    assert.ok(caseItem.agent.output.usage.input_tokens > 0);
    assert.deepEqual(caseItem.toolCalls.map((tool) => tool.name), ["get_shelf_event", "get_basket_evidence", "get_cart_history"]);
    assert.deepEqual(totals(state), totals(before));
    if (!selected) assert.equal(caseItem.nextAction, "STAFF_HITL");
    const blockedBasket = caseItem.candidate || "A";
    const blocked = await api("/api/checkout", { basketId: blockedBasket }, 409);
    assert.match(blocked.error, /pending/i);
    const callsBeforeRetry = report.modelCalls.length;
    await sendHardware(payload, { qos: 1 });
    assert.equal(report.modelCalls.length, callsBeforeRetry);
    for (const stream of [shopper, staff]) {
      await waitFor(() => stream.frames.some((frame) => frame.state.cases.some((item) => item.caseId === caseItem.caseId && item.agent?.status === "COMPLETED")), stream.label + " receives real agent state");
      assert.ok(stream.frames.some((frame) => frame.state.cases.some((item) => item.caseId === caseItem.caseId && item.agent?.status === "RUNNING")));
    }
    if (selected && caseItem.status === "WAITING_CUSTOMER") {
      await api("/api/cases/" + caseItem.caseId + "/customer", { answer: "YES" });
    } else if (selected) {
      await api("/api/cases/" + caseItem.caseId + "/staff", { decision: "APPROVE", basketId: selected });
    } else await rejectCase(caseItem);
    const closed = (await api("/api/state")).cases.find((item) => item.caseId === caseItem.caseId);
    assert.equal(closed.status, "CLOSED");
    const finalTotals = totals(await api("/api/state"));
    const expectedTotals = totals(before);
    if (selected) expectedTotals[selected === "A" ? 0 : 1] += 25;
    assert.deepEqual(finalTotals, expectedTotals);
    await api("/api/cases/" + caseItem.caseId + "/staff", { decision: "APPROVE", basketId: selected || "A" }, 409);
    passed("Ambiguous " + name + ": real model/tools, no charge before HITL, checkout blocked, duplicate ignored, both realtime streams, one human resolution", { caseId: caseItem.caseId, candidate: caseItem.candidate, confidence: caseItem.confidence, nextAction: caseItem.nextAction, resolution: closed.resolution });
  }

  const beforePutBack = await api("/api/state");
  const putBack = await sendHardware(signal({ A: -55, B: -57 }, "PUT_BACK"));
  assert.equal(putBack.caseItem.agent.status, "COMPLETED");
  assert.deepEqual(totals(putBack.state), totals(beforePutBack));
  await api("/api/cases/" + putBack.caseItem.caseId + "/staff", { decision: "APPROVE", basketId: "A" });
  assert.equal(lineQuantity(await api("/api/state"), "A", "COKE"), lineQuantity(beforePutBack, "A", "COKE") - 1);
  passed("Ambiguous PUT_BACK: real model, quantity removed only after staff validation");

  for (const [name, input, type] of [
    ["missing BLE", signal({ A: null, B: -51 }), "ZONE_UNKNOWN"],
    ["delayed signal", signal({ A: -51, B: -72 }, "PICK", "LANE-1", { delayed: true }), "DELAYED_EVENT"],
    ["empty-cart PUT_BACK", signal({ A: -72, B: -51 }, "PUT_BACK", "LANE-2"), "CONFLICT"],
  ]) {
    const before = await api("/api/state");
    const calls = report.modelCalls.length;
    const { state, caseItem } = await sendHardware(input);
    assert.equal(caseItem.type, type);
    assert.equal(caseItem.nextAction, "STAFF_HITL");
    assert.equal(report.modelCalls.length, calls);
    assert.deepEqual(totals(state), totals(before));
    await rejectCase(caseItem);
    passed(name + ": deterministic staff routing, no inference, no cart mutation");
  }

  const beforeFailure = await api("/api/state");
  modelMode = "503";
  const failed = await sendHardware(signal({ A: -55, B: -57 }));
  modelMode = "real";
  assert.equal(failed.caseItem.agent.provider, "LAYA");
  assert.equal(failed.caseItem.agent.status, "FAILED");
  assert.equal(failed.caseItem.nextAction, "STAFF_HITL");
  assert.deepEqual(totals(failed.state), totals(beforeFailure));
  await rejectCase(failed.caseItem);
  passed("Model HTTP 503: persisted FAILED audit, staff fallback, no substituted mock or charge");

  const slowInput = signal({ A: -55, B: -57 });
  const callsBeforeSlow = report.modelCalls.length;
  const totalsBeforeSlow = totals(await api("/api/state"));
  modelMode = "slow";
  await hardware.publishAsync(eventTopic, JSON.stringify(slowInput));
  await waitFor(() => report.modelCalls.length > callsBeforeSlow, "actual inference before delayed response");
  modelMode = "real";
  const runningCase = (await api("/api/state")).cases.find((item) => item.eventId === slowInput.eventId);
  assert.equal(runningCase.agent.status, "RUNNING");
  const earlyApproval = await api("/api/cases/" + runningCase.caseId + "/staff", { decision: "APPROVE", basketId: "A" }, 409);
  assert.match(earlyApproval.error, /investigation.*progress/i);
  await api("/api/checkout", { basketId: "A" }, 409);
  await delay(3100);
  await sendHardware({ ...slowInput, delayed: true });
  const completedSlow = await waitFor(async () => {
    const item = (await api("/api/state")).cases.find((entry) => entry.caseId === runningCase.caseId);
    return item.agent.status === "COMPLETED" && item;
  }, "slow actual inference completion");
  assert.equal(report.modelCalls.length, callsBeforeSlow + 1);
  assert.deepEqual(totals(await api("/api/state")), totalsBeforeSlow);
  await rejectCase(completedSlow);
  passed("Slow real model + 3-second device retry: one inference, ACK after persistence, premature staff/checkout blocked, delayed response cannot double-charge");

  modelMode = "timeout";
  const timeoutInput = signal({ A: -55, B: -57 });
  const callsBeforeTimeout = report.modelCalls.length;
  const timeoutStarted = performance.now();
  await hardware.publishAsync(eventTopic, JSON.stringify(timeoutInput));
  await waitFor(() => report.modelCalls.length > callsBeforeTimeout, "model timeout fault entered");
  modelMode = "real";
  const timedOutCase = await waitFor(async () => {
    const item = (await api("/api/state")).cases.find((entry) => entry.eventId === timeoutInput.eventId);
    return item?.agent?.status === "FAILED" && item;
  }, "30-second model client deadline", 35000);
  assert.equal(timedOutCase.nextAction, "STAFF_HITL");
  assert.equal(timedOutCase.candidate, null);
  assert.deepEqual(totals(await api("/api/state")), totalsBeforeSlow);
  assert.equal(acknowledgements.filter((item) => item.eventId === timeoutInput.eventId).length, 0);
  await sendHardware({ ...timeoutInput, delayed: true });
  assert.equal(report.modelCalls.length, callsBeforeTimeout + 1);
  await rejectCase(timedOutCase);
  passed("Actual 30-second HTTP timeout: no premature ACK, failed agent/staff audit, retry accepted without another model call or charge", { elapsedMs: Math.round(performance.now() - timeoutStarted) });

  const beforeInvalid = JSON.parse(await readFile(statePath, "utf8"));
  const ackCount = acknowledgements.length;
  const invalid = signal({ A: -51, B: -72 }, "PICK", "LANE-1", { sku: "WATER" });
  await hardware.publishAsync(eventTopic, "invalid JSON", { qos: 1 });
  await hardware.publishAsync(eventTopic, JSON.stringify(invalid), { qos: 1 });
  await waitFor(() => bridgeLogs.some((line) => line.includes("invalid JSON")) && bridgeLogs.some((line) => line.includes(invalid.eventId) && line.includes("not acknowledged")), "malformed signals rejected by bridge/compute");
  assert.equal(acknowledgements.length, ackCount);
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), beforeInvalid);
  passed("Malformed JSON and SKU/lane mismatch: no application ACK and no DB mutation");

  const reconnectSignal = signal({ A: -51, B: -72 }, "PICK", "LANE-2");
  const firstDelivery = await sendHardware(reconnectSignal);
  const reconnected = once(hardware, "connect");
  hardware.stream.destroy();
  await reconnected;
  await hardware.subscribeAsync(ackTopic, { qos: 1 });
  const retry = await sendHardware({ ...reconnectSignal, delayed: true });
  assert.deepEqual(totals(retry.state), totals(firstDelivery.state));
  passed("Device disconnect/reconnect and application retry: ACK restored without double charge");

  const beforeRestart = await api("/api/state");
  for (const stream of streams) stream.controller.abort();
  await Promise.all(streams.map((stream) => stream.task));
  await stopApp();
  await startApp();
  assert.deepEqual(await api("/api/state"), beforeRestart);
  const resumed = await subscribe("reconnected-client");
  assert.deepEqual(resumed.frames[0].state, beforeRestart);
  passed("App restart: sessions/cart/cases/audit survive disk reload; SSE reconnect gets persisted snapshot");

  const orderA = await api("/api/checkout", { basketId: "A" });
  assert.equal(orderA.order.total, beforeRestart.baskets.find((basket) => basket.basketId === "A").total);
  assert.equal(orderA.order.paymentMode, "MOCK");
  const missingSession = await sendHardware(signal({ A: -51, B: -72 }));
  assert.equal(missingSession.caseItem.type, "MISSING_SESSION");
  assert.equal(missingSession.state.baskets[0].total, 0);
  await rejectCase(missingSession.caseItem);
  passed("Mock checkout records correct confirmed total and closes session; subsequent signal requires staff");

  const audit = (await api("/api/audit", undefined)).items;
  for (const action of ["SHELF_EVENT_RECEIVED", "CASE_CREATED", "AGENT_STARTED", "AGENT_TOOL_COMPLETED", "AGENT_RECOMMENDATION", "AGENT_FAILED", "STAFF_APPROVED", "CART_VALIDATED", "CASE_CLOSED", "DUPLICATE_EVENT_IGNORED", "MOCK_CHECKOUT_COMPLETED"]) {
    // The API returns only the most recent page; inspect the durable audit below for older events.
    const raw = JSON.parse(await readFile(statePath, "utf8"));
    assert.ok(raw.auditLog.some((entry) => entry.action === action), "durable audit action " + action);
  }
  assert.ok(audit.length);
  passed("Durable audit contains device/FSM, actual model/tools, failed model, human decisions, validator, cart, duplicates and checkout");

  // Run cloud handler code on a separate real local repository; no DynamoDB or Step Functions emulator is claimed.
  const cloudRepository = new LocalJsonRepository(join(runDirectory, "lambda-state.json"));
  await cloudRepository.init();
  await cloudRepository.mutate((store) => { startSession(store, "A"); startSession(store, "B"); });
  const lambdaSignal = signal({ A: -55, B: -57 });
  const { result: created } = await cloudRepository.mutate((store) => processShelfEvent(store, lambdaSignal));
  const validate = createValidatorHandler({ getStore: () => cloudRepository });
  assert.equal((await validate({ caseId: created.caseId })).valid, false);
  const caseManager = createCaseManagerHandler({ getStore: () => cloudRepository, agentProvider: "laya", decision: ({ context }) => requestLayaBasketDecision({ context, endpoint: modelEndpoint }) });
  const investigated = await caseManager({ caseId: created.caseId });
  assert.equal(investigated.agent.provider, "LAYA");
  assert.equal(investigated.agent.status, "COMPLETED");
  assert.ok(investigated.agent.output.usage.input_tokens > 0);
  const lambdaTools = createAgentToolsHandler({ tableName: "local-test-adapter", documentClient: { send: async () => ({ Item: { data: await cloudRepository.read() } }) }, decision: ({ context }) => requestLayaBasketDecision({ context, endpoint: modelEndpoint }) });
  const toolResults = {};
  const cartsBeforeTools = structuredClone((await cloudRepository.read()).carts);
  for (const name of ["get_shelf_event", "get_basket_evidence", "get_cart_history", "get_basket_decision"]) {
    const result = await lambdaTools({ function: name, parameters: [{ name: "eventId", value: lambdaSignal.eventId }] });
    toolResults[name] = JSON.parse(result.response.functionResponse.responseBody.TEXT.body);
  }
  assert.deepEqual((await cloudRepository.read()).carts, cartsBeforeTools);
  assert.equal(toolResults.get_basket_decision.source, "LAYA");
  await cloudRepository.mutate((store) => staffDecision(store, created.caseId, "APPROVE", "A"));
  const validation = await validate({ caseId: created.caseId });
  assert.equal(validation.valid, true);
  const auditWriter = createAuditWriterHandler({ getStore: () => cloudRepository });
  await auditWriter({ action: "CASE_WORKFLOW_COMPLETED", actor: "LOCAL_WORKFLOW_TEST", details: { caseId: created.caseId, valid: validation.valid } });
  assert.equal((await cloudRepository.read()).carts.A.COKE, 1);
  const reload = new LocalJsonRepository(join(runDirectory, "lambda-state.json"));
  assert.ok((await reload.init()).auditLog.some((entry) => entry.action === "CASE_WORKFLOW_COMPLETED"));
  passed("Local Lambda chain: FSM → actual Laya case manager → four read-only tools → staff → validator → audit writer → disk reload", { validation, tools: Object.keys(toolResults) });

  const logs = appLogs.trim().split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  for (const event of ["SHELF_EVENT_PROCESSED", "AGENT_CASE_RESULT", "HUMAN_CASE_DECISION", "MOCK_CHECKOUT_COMPLETED", "HTTP_REQUEST_FAILED"]) assert.ok(logs.some((entry) => entry.event === event), "structured log event " + event);
  await writeFile(join(runDirectory, "application.log"), appLogs);
  await writeFile(join(runDirectory, "bridge.log"), bridgeLogs.join("\n"));
  report.realtimeFrames = Object.fromEntries(streams.map((stream) => [stream.label, stream.frames.length]));
  report.mqttApplicationAcks = acknowledgements.length;
  report.customerBranch = report.checks.some((check) => check.resolution?.actor === "CUSTOMER") ? "exercised with real model recommendation" : "not reached by real Laya scores; covered separately by deterministic policy tests, not claimed as real-model coverage";
  report.integrationPassed = true;
  report.modelDecisionQualityEstablished = false;
  passed("Structured compute/agent/HITL/error logs written and realtime stream counts captured");
} catch (error) {
  report.integrationPassed = false;
  report.error = { message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const stream of streams) stream.controller.abort();
  await Promise.allSettled(streams.map((stream) => stream.task));
  if (hardware) await hardware.endAsync(true);
  if (bridge) await bridge.endAsync(true);
  await stopApp();
  await new Promise((done) => broker.close(done));
  await new Promise((done) => mqttServer.close(done));
  modelProxy.closeAllConnections();
  await new Promise((done) => modelProxy.close(done));
  report.completedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await writeFile(join(runDirectory, "application.log"), appLogs);
  await writeFile(join(runDirectory, "bridge.log"), bridgeLogs.join("\n"));
  console.log(JSON.stringify({ integrationPassed: report.integrationPassed, checksPassed: report.checks.length, reportPath, runDirectory, customerBranch: report.customerBranch, error: report.error?.message }, null, 2));
}
