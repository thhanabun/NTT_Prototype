import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore, processShelfEvent, startSession } from "../src/domain.mjs";
import { investigateCase } from "../src/agent/case-manager.mjs";
import { DynamoDbRecordsRepository, stateRecords, META_KEY } from "../src/cloud/records-repository.mjs";
import { authenticate, pairingCode, scopedState, signShopper, verifyShopper } from "../src/cloud/auth.mjs";
import { createCloudHandlers } from "../src/cloud/handlers.mjs";
import { requestBedrockToolDecision } from "../src/cloud/bedrock-planner.mjs";
import { createAgentRuntime, createCloudToolsHandler } from "../src/cloud/agent-runtime.mjs";
import { attachDeviceTelemetry, createCloudTelemetry } from "../src/cloud/telemetry.mjs";
import { createCloudTelemetryHandler } from "../src/cloud/telemetry-handler.mjs";
import { bleLocations } from "../src/ble-location.mjs";
import { normalizeTelemetry } from "../src/evidence.mjs";
import { SHELF_IDS } from "../src/shelves.mjs";
import { cloudTemplate } from "../infra/cloud/template.mjs";

const key = "test-secret-never-used-in-cloud-" + "x".repeat(32);
function fixture(telemetry) {
  let store = createStore();
  const control = new Map(), calls = [];
  const repository = {
    async read() { return structuredClone(store); },
    async mutate(mutator) { const next = structuredClone(store); const result = mutator(next); store = next; return { result, store: structuredClone(store) }; },
  };
  const services = { repository, telemetry, calls, key: async () => key,
    verifyJwt: async token => { if (token === "staff") return { sub: "staff-1", username: "staff@test.invalid", "cognito:groups": ["STAFF"], exp: Date.now() / 1000 + 3600 }; throw new Error("Bad JWT"); },
    async get(id) { return control.get(id); }, async put(item) { control.set(item.id, item); }, async scan(filter) { return [...control.values()].filter(filter); },
    async startWorkflow(item) { calls.push(["workflow", item.caseId]); }, async acknowledge(shelfId, eventId) { calls.push(["ack", eventId]); },
    async resume(token, result) { calls.push(["callback", token, result]); }, async ticket(principal) { return { ticket: principal.role }; },
    async invokeAgent() { throw new Error("No AWS model called in fixtures"); }, async broadcast() { calls.push(["broadcast"]); },
  };
  const handlers = createCloudHandlers(services);
  const telemetryHandler = telemetry && createCloudTelemetryHandler(telemetry);
  async function api(path, body, authorization) {
    const response = await handlers.api({ rawPath: path, requestContext: { http: { method: body === undefined ? "GET" : "POST" } }, headers: authorization ? { authorization } : {}, body: body === undefined ? "" : JSON.stringify(body) });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }
  const ingest = (eventId, rssi = { A: -51, B: -72 }, eventType = "PICK") => handlers.ingest({ eventId, shelfId: "SHELF-01", mqttClientId: "SHELF-01", mqttTopic: "smartbasket/shelf/SHELF-01/events", laneId: "LANE-1", eventType, rssi });
  return { repository, services, handlers, telemetryHandler, control, calls, api, ingest };
}

test("Cloud record store round-trips state larger than 400 KB without a large item and preserves multiple camera frames", async () => {
  const records = new Map(); let conflict = false;
  const client = { async send(command) {
    const input = command.input;
    if (command.constructor.name === "GetCommand") return { Item: structuredClone(records.get(input.Key.stateKey)) };
    if (command.constructor.name === "BatchGetCommand") return { Responses: { state: input.RequestItems.state.Keys.map(key => records.get(key.stateKey)).filter(Boolean).map(item => structuredClone(item)) } };
    assert.equal(command.constructor.name, "TransactWriteCommand");
    const put = input.TransactItems[0].Put;
    if (conflict) {
      conflict = false; const meta = structuredClone(records.get(META_KEY)); meta.version++; meta.data.carts.B.WATER = 1; records.set(META_KEY, meta);
      throw Object.assign(new Error("Concurrent update"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
    }
    for (const operation of input.TransactItems) {
      if (operation.Put) records.set(operation.Put.Item.stateKey, structuredClone(operation.Put.Item));
      else records.delete(operation.Delete.Key.stateKey);
    }
    assert.ok(!put.Item.data.cases, "Case bodies cannot enter manifest");
    return {};
  } };
  const repository = new DynamoDbRecordsRepository({ tableName: "state", documentClient: client });
  await repository.mutate(store => {
    store.cases = Array.from({ length: 12 }, (_, i) => ({ caseId: "CASE-" + i, evidence: "e".repeat(40000) }));
    store.cameraEvidence = [{ eventId: "same-event", frameId: "one" }, { eventId: "same-event", frameId: "two" }];
  });
  const store = await repository.read();
  assert.ok(Buffer.byteLength(JSON.stringify(store)) > 400 * 1024); assert.equal(store.cases.length, 12); assert.equal(store.cameraEvidence.length, 2);
  assert.ok([...records.values()].every(record => Buffer.byteLength(JSON.stringify(record)) < 240000));
  conflict = true;
  await repository.mutate(store => { store.carts.A.COKE = 1; });
  assert.equal((await repository.read()).carts.A.COKE, 1); assert.equal((await repository.read()).carts.B.WATER, 1);
  await assert.rejects(repository.mutate(store => { store.cases[0].evidence = "e".repeat(250000); }), /240 KB/);
  assert.equal((await repository.read()).cases[0].evidence.length, 40000);
});

test("Cloud authorization rejects tampered/expired sessions and isolates shopper state, staff cases and audit", async () => {
  const store = createStore(), session = startSession(store, "A"); startSession(store, "B");
  store.carts.A.COKE = 1; store.carts.B.WATER = 2;
  const token = signShopper(key, { basket: "A", sessionId: session.sessionId });
  const principal = verifyShopper(key, token);
  assert.throws(() => verifyShopper(key, token + "tamper"), /Invalid/);
  assert.throws(() => verifyShopper(key, token, Date.now() + 3601000), /expired/);
  assert.equal(scopedState(store, principal).baskets.find(item => item.basketId === "B").lines.length, 0);
  assert.equal(scopedState(store, principal).baskets[0].total, 25);
  assert.equal(scopedState(store, { role: "PUBLIC" }).baskets[0].total, 0);
  processShelfEvent(store, { eventId: "pending-before-closed-history", laneId: "LANE-1", eventType: "PICK", rssi: { A: null, B: null } });
  const pending = store.cases[0];
  store.cases.unshift(...Array.from({ length: 31 }, (_, i) => ({ ...pending, caseId: `CASE-90${i}`, status: "CLOSED" })));
  assert.equal(scopedState(store, { role: "STAFF" }).cases[0].caseId, pending.caseId, "Closed history cannot hide an unresolved case");
  assert.equal(scopedState(store, principal).cases[0].caseId, pending.caseId);
  await assert.rejects(authenticate({ authorization: "Bearer bad" }, { key, verifyJwt: async () => { throw new Error("signature"); } }), /invalid/);
  await assert.rejects(authenticate({ authorization: "Bearer wrong-group" }, { key, verifyJwt: async () => ({ "cognito:groups": ["SHOPPER"] }) }), /Staff/);
});

test("Cloud API pairs by QR, retries an uncertain pairing safely and denies cross-basket checkout/stat/staff access", async () => {
  const f = fixture(), attempt = randomUUID();
  assert.equal((await f.api("/api/sessions", { basketId: "A" })).status, 403);
  const paired = await f.api("/api/sessions", { basketId: "A", pairingCode: pairingCode(key, "A"), pairingAttempt: attempt });
  assert.equal(paired.status, 201);
  const retry = await f.api("/api/sessions", { basketId: "A", pairingCode: pairingCode(key, "A"), pairingAttempt: attempt });
  assert.equal(retry.body.session.sessionId, paired.body.session.sessionId);
  assert.equal((await f.api("/api/sessions", { basketId: "A", pairingCode: pairingCode(key, "A"), pairingAttempt: randomUUID() })).status, 403);
  const authorization = "Basket " + paired.body.shopperToken;
  assert.equal((await f.api("/api/checkout", { basketId: "B" }, authorization)).status, 403);
  assert.equal((await f.api("/api/stats/query", { message: "ยอดขาย" }, authorization)).status, 403);
  assert.equal((await f.api("/api/cases/CASE-001/staff", { decision: "APPROVE", basketId: "A" }, authorization)).status, 403);
  assert.equal((await f.api("/api/events", {}, "Bearer staff")).status, 403, "Staff demo signals remain disabled by default");
  assert.equal((await f.api("/api/reset", {}, "Bearer staff")).status, 404);
  assert.equal((await f.api("/api/sessions", { basketId: "A", action: "RELEASE" }, authorization)).status, 403);
  assert.equal((await f.api("/api/sessions", { basketId: "A", action: "RELEASE" }, "Bearer staff")).status, 200);
  assert.equal((await f.repository.read()).activeSessions.A, null);
});

test("Cloud IoT ingestion persists before workflow and ACK, retries failed launches, retains deduplication, and enforces device identity", async () => {
  process.env.SHELF_ID = "SHELF-01";
  const f = fixture();
  await f.repository.mutate(store => startSession(store, "A"));
  await f.ingest("clear"); await f.ingest("clear");
  assert.equal((await f.repository.read()).carts.A.COKE, 1);
  assert.equal(f.calls.filter(call => call[0] === "workflow").length, 0);
  await f.repository.mutate(store => { store.seenEventIds = []; });
  await f.ingest("clear"); assert.equal((await f.repository.read()).carts.A.COKE, 1, "Durable cloud receipt outlives the short domain cache");
  await f.repository.mutate(store => startSession(store, "B"));
  f.services.startWorkflow = async () => { throw new Error("AWS workflow temporarily unavailable"); };
  await assert.rejects(f.ingest("workflow-retry", { A: -55, B: -57 }), /unavailable/);
  assert.equal(f.calls.some(call => call[0] === "ack" && call[1] === "workflow-retry"), false);
  f.services.startWorkflow = async item => { assert.ok((await f.repository.read()).cases.some(entry => entry.caseId === item.caseId)); f.calls.push(["workflow", item.caseId]); };
  await f.ingest("workflow-retry", { A: -55, B: -57 });
  assert.equal((await f.repository.read()).cases.length, 1); assert.equal(f.calls.at(-1)[0], "ack");
  await assert.rejects(f.handlers.ingest({ mqttTopic: "smartbasket/shelf/SHELF-01/events", mqttClientId: "attacker", shelfId: "SHELF-01" }), /identity/);
});

test("Cloud heartbeats use only shelf telemetry storage and retain receipt freshness across retry and reorder", async () => {
  const calls = [], rows = new Map();
  const telemetry = createCloudTelemetry("telemetry", { async send(command) {
    const { TableName, Item, Key, ConditionExpression, ExpressionAttributeValues: values, Limit } = command.input;
    assert.equal(TableName, "telemetry");
    calls.push(command.constructor.name);
    if (Item) {
      const id = `${Item.shelfId}/${Item.receiptKey}`;
      if (ConditionExpression && rows.get(id)?.receivedAtMs >= values[":receivedAtMs"]) {
        throw Object.assign(new Error("Outdated"), { name: "ConditionalCheckFailedException" });
      }
      rows.set(id, structuredClone(Item));
      return {};
    }
    if (Key) return { Item: rows.get(`${Key.shelfId}/${Key.receiptKey}`) };
    const Items = [...rows.values()].filter(row => row.shelfId === values[":shelfId"] &&
      row.receiptKey >= values[":from"] && row.receiptKey <= values[":to"]).sort((a, b) => b.receiptKey - a.receiptKey).slice(0, Limit);
    return { Items };
  } });
  const f = fixture(telemetry), now = Date.now();
  const heartbeat = (shelfId, mqttReceivedAt, rssi = -51) => ({ shelfId, mqttReceivedAt, mqttTopic: `smartbasket/shelf/${shelfId}/telemetry`, mqttClientId: shelfId, rssi: { A: rssi } });
  const { read, mutate } = f.repository;
  f.repository.read = f.repository.mutate = async () => assert.fail("Heartbeat touched transaction state");
  await f.telemetryHandler(heartbeat("SHELF-01", now));
  await f.telemetryHandler(heartbeat("SHELF-01", now)); // Lambda retries share the IoT receipt time.
  await f.telemetryHandler(heartbeat("SHELF-01", now - 1000, -82));
  await f.telemetryHandler(heartbeat("SHELF-02", now - 6000));
  await f.telemetryHandler(heartbeat("SHELF-03", undefined));
  await assert.rejects(f.telemetryHandler({ ...heartbeat("SHELF-03", now), mqttClientId: "SHELF-02" }), /identity/);
  await assert.rejects(f.telemetryHandler(heartbeat("SHELF-03", now, -128)), /Invalid telemetry RSSI/);
  assert.deepEqual(await f.handlers.ingest(heartbeat("SHELF-03", undefined)), { ok: true }, "Old queued telemetry drains without storage writes");
  assert.deepEqual(calls, Array(8).fill("PutCommand"));
  assert.equal(rows.size, 5);
  assert.equal(rows.get(`SHELF-01/${now}`).ttl, Math.floor(now / 1000) + 3600);
  assert.deepEqual(f.calls, []);
  Object.assign(f.repository, { read, mutate });
  const legacySample = normalizeTelemetry({ shelfId: "SHELF-03", rssi: { A: -60 } }, new Date(now - 6000).toISOString());
  const { result: session } = await f.repository.mutate(store => { store.telemetry = [legacySample]; return startSession(store, "A"); });
  const staff = await f.api("/api/state", undefined, "Bearer staff");
  assert.equal(staff.status, 200);
  assert.deepEqual(staff.body.shelves.map(({ device }) => [device.status, device.lastSeenAt, device.rssi.A]), [
    ["ONLINE", new Date(now).toISOString(), -51], ["OFFLINE", new Date(now - 6000).toISOString(), null], ["OFFLINE", legacySample.receivedAt, null],
  ]);
  calls.length = 0;
  await f.api("/api/state", undefined, "Basket " + signShopper(key, { basket: "A", sessionId: session.sessionId }));
  await f.api("/api/state");
  await f.ingest("evidence-window", { A: -55, B: -57 });
  await f.ingest("evidence-window", { A: -55, B: -57 });
  assert.deepEqual(calls, []);
  assert.equal(f.calls.filter(([type]) => type === "ack").length, 2);
  const stored = await f.repository.read();
  assert.deepEqual(stored.telemetry, [legacySample]);
  const tool = createCloudToolsHandler(f.repository, telemetry);
  const task = { caseId: stored.cases[0].caseId, input: { eventId: "evidence-window" } };
  await tool({ ...task, tool: "get_shelf_event" });
  assert.deepEqual(calls, []);
  const window = await tool({ ...task, tool: "get_signal_window" });
  assert.deepEqual(calls, ["QueryCommand"]);
  assert.deepEqual(window.samples.map(sample => sample.rssi.A), [-51, -82]);

  calls.length = 0;
  const simultaneousReceipt = Date.now() + 1;
  f.repository.read = f.repository.mutate = async () => assert.fail("Concurrent heartbeats touched transaction state");
  await Promise.all(SHELF_IDS.map(shelfId => f.telemetryHandler(heartbeat(shelfId, simultaneousReceipt))));
  assert.deepEqual(calls, Array(6).fill("PutCommand"));
  Object.assign(f.repository, { read, mutate });
  const simultaneousState = await f.api("/api/state", undefined, "Bearer staff");
  assert.deepEqual(simultaneousState.body.shelves.map(({ device }) => device.status), ["ONLINE", "ONLINE", "ONLINE"]);
});

test("Cloud staff telemetry merges legacy samples chronologically for calibrated three-shelf BLE", async () => {
  const config = { tags: { A: { enterRssiDbm: -60, exitRssiDbm: -75, fingerprints: [{
    x: 2, y: 3, rssi: Object.fromEntries(SHELF_IDS.map(shelfId => [shelfId, -50])),
  }] } } };
  const now = Date.now();
  const recent = SHELF_IDS.map(shelfId => [1000, 2000].map(age => normalizeTelemetry({ shelfId, rssi: { A: -50 } }, new Date(now - age).toISOString())));
  const legacy = normalizeTelemetry({ shelfId: SHELF_IDS[0], rssi: { A: -50 } }, new Date(now - 250).toISOString());
  const seed = {};
  const store = { telemetry: [legacy], bleLocationState: seed };
  const index = shelfId => SHELF_IDS.indexOf(shelfId);
  await attachDeviceTelemetry(store, { latest: async shelfId => recent[index(shelfId)][0], recent: async shelfId => recent[index(shelfId)] }, config);
  assert.deepEqual(seed, {});
  const [estimate] = bleLocations(store, now, config);
  assert.deepEqual([estimate.presence, estimate.status, estimate.x, estimate.y], ["INSIDE", "TRACKING", 2, 3]);
});

test("Cloud evidence centers on IoT receipt even when a device event waits in the Lambda queue", async () => {
  const receipt = Date.now() - 20_000, iotReceivedAt = new Date(receipt).toISOString();
  const sample = normalizeTelemetry({ shelfId: "SHELF-01", rssi: { A: -55 },
    lanes: [{ laneId: "LANE-1", present: true }], uptimeMs: 123000, queueDepth: 0, droppedEvents: 0 }, iotReceivedAt);
  const windows = [];
  const telemetry = { async recent(shelfId, from, to) { windows.push([shelfId, from, to]); return [sample]; } };
  const f = fixture(telemetry);
  const input = { eventId: "queued-evidence", shelfId: "SHELF-01", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } };
  const result = await f.handlers.ingest({ ...input, mqttTopic: "smartbasket/shelf/SHELF-01/events", mqttClientId: "SHELF-01", mqttReceivedAt: receipt });
  assert.equal(result.event.iotReceivedAt, iotReceivedAt);
  assert.ok(Date.parse(result.event.receivedAt) - receipt > 5000);
  assert.equal(result.event.delayed, false);
  assert.deepEqual(f.calls.at(-1), ["ack", input.eventId]);
  const invoke = createCloudToolsHandler(f.repository, telemetry);
  const run = tool => invoke({ caseId: result.caseId, tool, input: { eventId: input.eventId } });
  assert.deepEqual((await run("get_signal_window")).samples, [sample]);
  assert.equal((await run("get_lane_state")).sample.present, true);
  assert.equal((await run("get_device_health")).status, "STALE");
  assert.deepEqual(windows, [3000, 3000, 5000].map(ms => ["SHELF-01", receipt - ms, receipt + ms]));
  assert.equal(processShelfEvent(createStore(), { ...input, iotReceivedAt, mqttReceivedAt: receipt }).event.iotReceivedAt, undefined);
  f.services.demoSignalsEnabled = true;
  assert.equal((await f.api("/api/events", { ...input, eventId: "web-demo-" + randomUUID(), mqttReceivedAt: receipt }, "Bearer staff")).status, 400);
});

test("Cloud HITL survives callback failure without double charging; NO and timeout escalate, validation requires a human resolution", async () => {
  process.env.SHELF_ID = "SHELF-01";
  const f = fixture();
  const session = (await f.repository.mutate(store => startSession(store, "A"))).result;
  const authorization = "Basket " + signShopper(key, { basket: "A", sessionId: session.sessionId });
  await f.ingest("ambiguous", { A: -55, B: -57 });
  await f.repository.mutate(store => investigateCase(store, "CASE-001"));
  assert.equal((await f.api("/api/cases/CASE-001/customer", { answer: "YES" }, authorization)).status, 409, "Cannot answer before a workflow handoff");
  await f.handlers.handoff({ caseId: "CASE-001", stage: "CUSTOMER", taskToken: "private-callback-token" });
  f.services.resume = async () => { throw new Error("Callback transport failed"); };
  assert.equal((await f.api("/api/cases/CASE-001/customer", { answer: "YES" }, authorization)).status, 409);
  assert.equal((await f.repository.read()).carts.A.COKE, 1);
  f.services.resume = async (token, value) => f.calls.push(["callback", token, value]);
  await f.handlers.reconcile();
  const confirmed = await f.api("/api/cases/CASE-001/customer", { answer: "YES" }, authorization);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(Object.keys(confirmed.body.case.evidence), ["zone"]);
  assert.equal((await f.repository.read()).carts.A.COKE, 1);
  assert.equal((await f.handlers.validate({ caseId: "CASE-001" })).valid, true);
  for (const [eventId, id, answer] of [["decline", "CASE-002", "NO"], ["timeout", "CASE-003", null]]) {
    await f.ingest(eventId, { A: -55, B: -57 }); await f.repository.mutate(store => investigateCase(store, id));
    await f.handlers.handoff({ caseId: id, stage: "CUSTOMER", taskToken: "customer-" + id });
    if (answer) assert.equal((await f.api(`/api/cases/${id}/customer`, { answer }, authorization)).status, 200);
    await f.handlers.handoff({ caseId: id, stage: "STAFF", taskToken: "staff-" + id });
    assert.equal((await f.repository.read()).cases.find(item => item.caseId === id).status, "OPEN_STAFF");
    await assert.rejects(f.handlers.validate({ caseId: id }), /resolution/);
    assert.equal((await f.api(`/api/cases/${id}/staff`, { decision: "REJECT" }, "Bearer staff")).status, 200);
  }
  assert.equal((await f.repository.read()).carts.A.COKE, 1);
});

test("Bedrock tool planner sends an enum and rejects text, repeated/unavailable actions and invented confidence", async () => {
  const actions = [{ id: "get_shelf_event", description: "Read event" }];
  const result = await requestBedrockToolDecision({ context: { observations: [] }, actions, modelId: "test-model", client: { async send(command) {
    assert.deepEqual(command.input.toolConfig.tools[0].toolSpec.inputSchema.json.properties.action.enum, ["get_shelf_event"]);
    return { stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "select_action", input: { action: "get_shelf_event" } } }] } } };
  } } });
  assert.equal(result.action, "get_shelf_event"); assert.equal(result.confidence, undefined);
  await assert.rejects(requestBedrockToolDecision({ context: {}, actions, modelId: "test-model", client: { async send() { return { stopReason: "end_turn", output: { message: { content: [{ text: "Approve basket A" }] } } }; } } }), /exactly one/);
});

test("AgentCore invokes bounded evidence Lambdas, keeps vision local to its container and never charges on a model result", async () => {
  const f = fixture();
  await f.repository.mutate(store => { startSession(store, "A"); processShelfEvent(store, { eventId: "agentcore", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } }); });
  const tool = createCloudToolsHandler(f.repository), selected = ["get_shelf_event", "get_basket_evidence", "get_cart_history", "DECIDE"];
  const run = createAgentRuntime({ repository: f.repository, toolFunctionArn: "evidence-lambda", planner: async () => ({ action: selected.shift(), model: "BEDROCK_FIXTURE" }), decision: async () => ({ candidate: "A", confidence: 0.82, model: "LAYA_FIXTURE" }), lambda: { async send(command) { return { Payload: Buffer.from(JSON.stringify(await tool(JSON.parse(command.input.Payload)))) }; } } });
  const result = await run({ type: "CASE", caseId: "CASE-001" });
  assert.equal(result.nextAction, "CUSTOMER_CONFIRM"); assert.equal((await f.repository.read()).carts.A.COKE, undefined);
  assert.equal((await f.repository.read()).cases[0].agent.provider, "BEDROCK");
  await assert.rejects(tool({ caseId: "CASE-001", tool: "get_shelf_event", input: { eventId: "another-event" } }), /belong/);
  await assert.rejects(run({ type: "SHELL", prompt: "anything" }), /Invalid/);
});

test("Prepared SAM infrastructure references real resources, avoids dependency cycles, enables retries/retention and routes customer NO to staff", () => {
  const template = cloudTemplate(), resources = template.Resources;
  const graph = new Map();
  function dependencies(value, set) {
    if (!value || typeof value !== "object") return;
    if (value.Ref && !value.Ref.startsWith("AWS::") && !template.Parameters[value.Ref]) { assert.ok(resources[value.Ref], value.Ref); set.add(value.Ref); }
    if (value["Fn::GetAtt"]) { const name = value["Fn::GetAtt"][0]; assert.ok(resources[name], name); set.add(name); }
    if (typeof value["Fn::Sub"] === "string") for (const match of value["Fn::Sub"].matchAll(/\$\{([A-Za-z][A-Za-z0-9]*)(?:\.[^}]+)?\}/g)) if (resources[match[1]]) set.add(match[1]);
    for (const child of Object.values(value)) dependencies(child, set);
  }
  for (const [name, item] of Object.entries(resources)) {
    const set = new Set(); dependencies(item, set);
    if (item.Type === "AWS::Serverless::Function") dependencies(template.Globals.Function, set);
    graph.set(name, set);
  }
  function visit(name, path = []) { assert.ok(!path.includes(name), "Circular dependency: " + [...path, name]); for (const next of graph.get(name)) visit(next, [...path, name]); }
  for (const name of graph.keys()) visit(name);
  assert.equal(resources.CaseWorkflow.Properties.Definition.States.AfterCustomer.Default, "StaffApproval");
  assert.equal(resources.StateTable.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, true);
  assert.equal(resources.ControlTable.Properties.TimeToLiveSpecification.AttributeName, "ttl");
  assert.equal(resources.TelemetryTable.Properties.TimeToLiveSpecification.AttributeName, "ttl");
  assert.equal(resources.TelemetryTable.Properties.StreamSpecification, undefined);
  assert.equal(resources.ApiFunctionLog.Properties.RetentionInDays, 14);
  const api = resources.ApiFunction.Properties;
  assert.equal(api.Environment.Variables.SHOPPER_AGENT_PROVIDER, "bedrock");
  assert.equal(api.Environment.Variables.SHOPPER_AGENT_MODE, "model");
  assert.deepEqual(api.Environment.Variables.BEDROCK_MODEL_ID, { Ref: "BedrockModelId" });
  const shopperInvoke = api.Policies[0].Statement.find(statement => statement.Action === "bedrock:InvokeModel");
  assert.deepEqual(shopperInvoke.Resource, { Ref: "BedrockInvokeResources" });
  assert.ok(resources.Trail && resources.Budget && resources.FailureQueue && resources.ArchiveBucket);
  assert.match(resources.ShelfRule.Properties.TopicRulePayload.Sql, /WHERE topic\(4\) = 'events'/);
  assert.doesNotMatch(resources.ShelfRule.Properties.TopicRulePayload.Sql, /'telemetry'/);
  assert.match(resources.TelemetryRule.Properties.TopicRulePayload.Sql, /topic\(4\) = 'telemetry'/);
  assert.equal(resources.TelemetryFunction.Properties.Handler, "src/cloud/telemetry-handler.ingest");
  assert.ok(!resources.IngestFunction.Properties.Policies[0].Statement.some(statement => JSON.stringify(statement.Resource).includes("TelemetryTable")));
  assert.ok(!resources.TelemetryFunction.Properties.Policies[0].Statement.some(statement => JSON.stringify(statement.Resource).includes("StateTable")));
  assert.match(resources.ShelfRule.Properties.TopicRulePayload.Sql, /timestamp\(\) AS mqttReceivedAt/);
  assert.equal(resources.ShelfRule.Properties.TopicRulePayload.ErrorAction, undefined);
  assert.equal(resources.IoTErrorRole, undefined);
  assert.ok(!resources.ToolsFunction.Properties.Policies[0].Statement.some(statement => statement.Action.includes("dynamodb:PutItem")));
  assert.throws(() => stateRecords({ ...createStore(), cases: [{ caseId: "same" }, { caseId: "same" }] }), /Duplicate/);
});
