import { spawn } from "node:child_process";
import { createRepository } from "../../src/store-repository.mjs";
import { createAgentRuntime, serveAgentRuntime } from "../../src/cloud/agent-runtime.mjs";

const children = [
  spawn("/opt/laya/bin/python", ["-m", "laya.serve"], { stdio: "inherit", env: { ...process.env, LAYA_HOST: "127.0.0.1", LAYA_PORT: "8000" } }),
  spawn("/opt/vision/bin/python", ["scripts/vision-service.py"], { stdio: "inherit" }),
];
let ready = false;
const repository = createRepository({ backend: "dynamodb-records", tableName: process.env.STATE_TABLE });
const server = serveAgentRuntime(createAgentRuntime({ repository }), { ready: () => ready });
function shutdown(code) { ready = false; for (const child of children) child.kill(); server.close(); process.exit(code); }
for (const child of children) { child.on("error", () => shutdown(1)); child.on("exit", () => shutdown(1)); }
for (const event of ["SIGTERM", "SIGINT"]) process.once(event, () => shutdown(0));
const deadline = Date.now() + 240000;
while (!ready) {
  try {
    const health = await Promise.all([8000, 8001].map(port => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })));
    ready = health.every(response => response.ok);
  } catch { /* Wait for model preload before advertising readiness. */ }
  if (Date.now() > deadline) shutdown(1);
  if (!ready) await new Promise(resolve => setTimeout(resolve, 1000));
}
console.log(JSON.stringify({ event: "AGENT_RUNTIME_READY", models: ["laya/typed-decisions", "yolo11n"], planner: process.env.BEDROCK_MODEL_ID }));
