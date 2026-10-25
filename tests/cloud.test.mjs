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
import { cloudTemplate } from "../infra/cloud/template.mjs";

const key = "test-secret-never-used-in-cloud-" + "x".repeat(32);
function fixture() {
  let store = createStore();
  const control = new Map(), calls = [];
  const repository = {
    async read() { return structuredClone(store); },
    async mutate(mutator) { const next = structuredClone(store); const result = mutator(next); store = next; return { result, store: structuredClone(store) }; },
  };
  const services = { repository, calls, key: async () => key,
    verifyJwt: async token => { if (token === "staff") return { sub: "staff-1", username: "staff@test.invalid", "cognito:groups": ["STAFF"], exp: Date.now() / 1000 + 3600 }; throw new Error("Bad JWT"); },
    async get(id) { return control.get(id); }, async put(item) { control.set(item.id, item); }, async scan(filter) { return [...control.values()].filter(filter); },
    async startWorkflow(item) { calls.push(["workflow", item.caseId]); }, async acknowledge(shelfId, eventId) { calls.push(["ack", eventId]); },
    async resume(token, result) { calls.push(["callback", token, result]); }, async ticket(principal) { return { ticket: principal.role }; },
    async invokeAgent() { throw new Error("No AWS model called in fixtures"); }, async broadcast() { calls.push(["broadcast"]); },
  };
  const handlers = createCloudHandlers(services);
  async function api(path, body, authorization) {
    const response = await handlers.api({ rawPath: path, requestContext: { http: { method: body === undefined ? "GET" : "POST" } }, headers: authorization ? { authorization } : {}, body: body === undefined ? "" : JSON.stringify(body) });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }
  const ingest = (eventId, rssi = { A: -51, B: -72 }, eventType = "PICK") => handlers.ingest({ eventId, shelfId: "SHELF-01", mqttClientId: "SHELF-01", mqttTopic: "smartbasket/shelf/SHELF-01/events", laneId: "LANE-1", eventType, rssi });
  return { repository, services, handlers, control, calls, api, ingest };
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
  assert.equal(resources.ApiFunctionLog.Properties.RetentionInDays, 14);
  assert.ok(resources.Trail && resources.Budget && resources.FailureQueue && resources.ArchiveBucket);
  assert.match(resources.ShelfRule.Properties.TopicRulePayload.Sql, /WHERE \(topic\(4\) = 'events' OR topic\(4\) = 'telemetry'\)/);
  assert.equal(resources.ShelfRule.Properties.TopicRulePayload.ErrorAction, undefined);
  assert.equal(resources.IoTErrorRole, undefined);
  assert.ok(!resources.ToolsFunction.Properties.Policies[0].Statement.some(statement => statement.Action.includes("dynamodb:PutItem")));
  assert.throws(() => stateRecords({ ...createStore(), cases: [{ caseId: "same" }, { caseId: "same" }] }), /Duplicate/);
});
