import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAgentToolsHandler } from "../infra/lambda/agent-tools.mjs";

const healthUrl = new URL("/health", process.env.LAYA_ENDPOINT || "http://127.0.0.1:8000/v1/systemone");
const healthResponse = await fetch(healthUrl, {
  headers: process.env.LAYA_API_KEY ? { authorization: "Bearer " + process.env.LAYA_API_KEY } : {},
  signal: AbortSignal.timeout(5000),
});
assert.ok(healthResponse.ok, "Start the real Laya model server before running this check");
const health = await healthResponse.json();
await mkdir("data", { recursive: true });
const runDirectory = await mkdtemp(resolve("data/laya-live-"));
const statePath = join(runDirectory, "state.json");
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
let output = "";
const app = spawn(process.execPath, ["src/server.mjs"], {
  cwd: resolve("."),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STORE_BACKEND: "local", STORE_PATH: statePath, AGENT_PROVIDER: "laya", AGENT_MODE: "workflow" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
app.stdout.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
app.stderr.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
const origin = "http://127.0.0.1:" + port;
async function api(path, body) {
  const response = await fetch(origin + path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : {});
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
const report = {
  timestamp: new Date().toISOString(),
  modelExecution: "real Laya HTTP inference; no injected model responses",
  hardware: "simulated shelf events",
  database: "isolated LocalJsonRepository",
  cloud: "Lambda adapter contract runs locally; AWS not deployed",
  health,
  cases: [],
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error("App failed to start: " + output);
    try { await api("/api/state"); ready = true; break; } catch { await delay(100); }
  }
  assert.ok(ready, "App did not become ready: " + output);
  await api("/api/sessions", { basketId: "A" });
  await api("/api/sessions", { basketId: "B" });
  const clear = await api("/api/events", {
    eventId: "live-clear", laneId: "LANE-1", eventType: "PICK", rssi: { A: -51, B: -72 },
  });
  assert.equal(clear.disposition, "CONFIRMED");
  assert.equal((await api("/api/state")).cases.length, 0);
  for (const [name, rssi, expected] of [
    ["near-a", { A: -55, B: -57 }, "A"],
    ["near-b", { A: -57, B: -55 }, "B"],
    ["tie", { A: -56, B: -56 }, null],
  ]) {
    const input = { eventId: "live-" + name, laneId: "LANE-1", eventType: "PICK", rssi };
    const before = await api("/api/state");
    const result = await api("/api/events", input);
    const state = await api("/api/state");
    const item = state.cases.find((entry) => entry.caseId === result.caseId);
    assert.equal(item.agent.provider, "LAYA");
    assert.equal(item.agent.status, "COMPLETED");
    assert.ok(item.agent.output.usage.input_tokens > 0, "The model must report actual processed tokens");
    assert.deepEqual(state.baskets.map((basket) => basket.total), before.baskets.map((basket) => basket.total));
    if (name === "tie") assert.equal(item.nextAction, "STAFF_HITL");
    report.cases.push({ scenario: name, expectedCandidate: expected, actual: item.agent.output, nextAction: item.nextAction });
    assert.equal((await api("/api/events", input)).duplicate, true);
    if (name !== "tie") {
      if (item.status === "WAITING_CUSTOMER") {
        await api("/api/cases/" + item.caseId + "/customer", { answer: "YES" });
      } else {
        await api("/api/cases/" + item.caseId + "/staff", { decision: "APPROVE", basketId: expected });
      }
    } else {
      await api("/api/cases/" + item.caseId + "/staff", { decision: "REJECT" });
    }
  }
  const unknown = await api("/api/events", {
    eventId: "live-no-tag", laneId: "LANE-1", eventType: "PICK", rssi: { A: null, B: null },
  });
  const final = await api("/api/state");
  assert.equal(final.cases.find((item) => item.caseId === unknown.caseId).type, "ZONE_UNKNOWN");
  const rawStore = JSON.parse(await readFile(statePath, "utf8"));
  const cartsBefore = JSON.stringify(rawStore.carts);
  const tool = createAgentToolsHandler({
    tableName: "local-contract-fixture",
    documentClient: { send: async () => ({ Item: { data: rawStore } }) },
  });
  const response = await tool({
    function: "get_basket_decision",
    actionGroup: "SmartBasketEvidence",
    parameters: [{ name: "eventId", value: "live-near-a" }],
  });
  const decision = JSON.parse(response.response.functionResponse.responseBody.TEXT.body);
  assert.equal(decision.source, "LAYA");
  assert.ok(decision.usage.input_tokens > 0);
  assert.equal(JSON.stringify(rawStore.carts), cartsBefore);
  report.lambdaDecisionTool = decision;
  report.audit = (await api("/api/audit")).items.filter((entry) => entry.actor === "LAYA_AGENT")
    .map((entry) => ({ action: entry.action, caseId: entry.details?.caseId }));
  assert.ok(report.audit.some((entry) => entry.action === "AGENT_RECOMMENDATION"));
  report.safety = "Pending totals unchanged; duplicate events ignored; tied/missing evidence requires staff; model tool is read-only";
  report.statePath = statePath;
  report.integrationPassed = true;
  const agreements = report.cases.filter((item) => item.actual.candidate === item.expectedCandidate).length;
  report.modelQuality = {
    illustrativeSamples: report.cases.length,
    topChoiceAgreements: agreements,
    autonomousDecisionQualityEstablished: false,
    note: "These synthetic probes are integration samples, not a benchmark. Human resolution is required; do not lower policy thresholds to force acceptance.",
  };
  await writeFile("data/laya-live-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  app.kill();
}
