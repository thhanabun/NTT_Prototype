import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
async function docker(...args) {
  const { stdout, stderr } = await exec("docker", args, { windowsHide: true, timeout: ["run", "exec"].includes(args[0]) ? 180000 : 60000, maxBuffer: 4 * 1024 * 1024 });
  return (stdout + (args[0] === "logs" ? stderr : "")).trim();
}
await mkdir("data", { recursive: true });
const directory = await mkdtemp(resolve("data/cloud-images-"));
const names = [], suffix = Date.now();
const report = { at: new Date().toISOString(), awsDeployed: false, cloudServices: "not invoked", hardware: "not connected", checks: [] };
const checked = (name, result) => { report.checks.push({ name, result }); console.log("PASS " + name); };
async function start(kind, image, architecture, port, environment) {
  const name = `basketly-cloud-check-${kind}-${suffix}`;
  names.push(name);
  await docker("run", "-d", "--platform", "linux/" + architecture, "--name", name, "-p", `127.0.0.1::${port}`, ...Object.entries(environment).flatMap(([key, value]) => ["-e", key + "=" + value]), image);
  const state = JSON.parse(await docker("inspect", name))[0];
  return { name, origin: "http://127.0.0.1:" + state.NetworkSettings.Ports[`${port}/tcp`][0].HostPort };
}
async function ready(container, path, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if ((await fetch(container.origin + path, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* Model preload is asynchronous. */ }
    const state = JSON.parse(await docker("inspect", container.name))[0].State;
    assert.ok(state.Running, `${container.name} exited: ${await docker("logs", container.name)}`);
    await delay(1000);
  }
  throw new Error(`${container.name} did not become ready`);
}
try {
  for (const [image, arch] of [["basketly-cloud-web:check", "amd64"], ["basketly-cloud-agent:check", "arm64"]]) {
    const info = JSON.parse(await docker("image", "inspect", image))[0];
    assert.equal(info.Architecture, arch);
    assert.ok(info.Config.User && info.Config.User !== "root");
    checked(`${image} architecture and non-root user`, { id: info.Id, architecture: info.Architecture, user: info.Config.User });
  }
  const web = await start("web", "basketly-cloud-web:check", "amd64", 3001, {
    CLOUD_API_ORIGIN: "https://api.example.invalid", COGNITO_DOMAIN: "https://identity.example.invalid",
    COGNITO_CLIENT_ID: "container-fixture", WEB_ORIGIN: "https://web.example.invalid", CLOUD_WEBSOCKET_URL: "wss://realtime.example.invalid/live",
  });
  await ready(web, "/", 60000);
  assert.equal((await fetch(web.origin + "/admin/login")).status, 200);
  const config = await fetch(web.origin + "/api/config").then(response => response.json());
  assert.equal(config.websocketUrl, "wss://realtime.example.invalid/live");
  const login = await fetch(web.origin + "/api/auth/login", { redirect: "manual" });
  assert.equal(new URL(login.headers.get("location")).searchParams.get("code_challenge_method"), "S256");
  assert.match(login.headers.get("set-cookie"), /HttpOnly/i);
  assert.equal((await fetch(web.origin + "/api/checkout", { method: "POST" })).status, 403);
  checked("production web startup, runtime config, PKCE cookie and CSRF", { status: "OK" });
  const agent = await start("agent", "basketly-cloud-agent:check", "arm64", 8080, {
    STATE_TABLE: "container-fixture", TOOLS_FUNCTION_ARN: "container-fixture", BEDROCK_MODEL_ID: "container-fixture",
    AWS_REGION: "us-east-1", AWS_EC2_METADATA_DISABLED: "true",
  });
  await ready(agent, "/ping", 270000);
  checked("AgentCore HTTP readiness after real Laya and YOLO preload", await fetch(agent.origin + "/ping").then(response => response.json()));
  const vision = JSON.parse(await docker("exec", agent.name, "node", "--input-type=module", "-e", `
    const health = await fetch('http://127.0.0.1:8001/health').then(r=>r.json());
    const inference = await fetch('http://127.0.0.1:8001/infer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({frameId:'demo-people'})}).then(r=>r.json());
    console.log(JSON.stringify({health,inference}));`));
  assert.equal(vision.inference.status, "AVAILABLE");
  assert.equal(vision.inference.model, "yolo11n");
  assert.ok(vision.inference.detections.length > 0);
  assert.match(vision.inference.limitation, /MOCK/);
  checked("real YOLO11n CPU inference on registered MOCK image", vision);
  const laya = JSON.parse(await docker("exec", agent.name, "node", "--input-type=module", "-e", `
    const response = await fetch('http://127.0.0.1:8000/v1/systemone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      model:'typed-decisions',state:{rssi:{A:-51,B:-72}},max_len:256,
      questions:{basket:{type:'choice',instructions:'Choose the nearest basket from these mock RSSI readings.',criteria:{A:'Basket A is nearest',B:'Basket B is nearest',NONE:'No basket evidence'}}}
    }),signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(await response.text());console.log(JSON.stringify(await response.json()));`));
  assert.ok(["A", "B", "NONE"].includes(laya.answers?.basket?.choice));
  assert.ok(laya.usage?.input_tokens > 0, "Laya must report processed input tokens");
  checked("real Laya CPU typed inference on MOCK RSSI (warmup before timed application call)", laya);
  const response = await fetch(agent.origin + "/invocations", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "STAT_PLAN", message: "Show daily sales revenue for 7 days as a bar chart", now: new Date().toISOString() }), signal: AbortSignal.timeout(60000) });
  const plan = await response.json();
  assert.equal(response.status, 200, JSON.stringify(plan));
  assert.equal(plan.plan.tool, "query_daily_sales"); assert.equal(plan.plan.chart, "bar");
  assert.ok(typeof plan.model.name === "string" && plan.model.name.length > 0);
  checked("AgentCore STAT_PLAN uses real local Laya inference", plan);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message + (error.stderr || "");
  for (const name of names) {
    try { await writeFile(join(directory, name + ".log"), await docker("logs", name)); } catch { /* Preserve the original failure. */ }
  }
  process.exitCode = 1;
} finally {
  for (const name of names.reverse()) {
    try { await docker("rm", "-f", name); }
    catch (error) { if (!error.stderr?.includes("No such container")) { report.passed = false; report.cleanupError = error.message; process.exitCode = 1; } }
  }
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log("Cloud image evidence: " + directory);
  if (!report.passed) console.error(report.error);
}
