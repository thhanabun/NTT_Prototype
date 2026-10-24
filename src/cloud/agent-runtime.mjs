import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { createRepository } from "../store-repository.mjs";
import { investigateStoredCase } from "../agent/investigate-stored-case.mjs";
import { requestLayaBasketDecision } from "../agent/laya.mjs";
import { runAgentTool, TOOL_DESCRIPTIONS } from "../agent/tools.mjs";
import { planStatsQuery } from "../stats-query.mjs";
import { requestBedrockToolDecision } from "./bedrock-planner.mjs";

export function createCloudToolsHandler(repository) {
  return async function handler(event) {
    const store = await repository.read();
    const item = store.cases.find(item => item.caseId === event.caseId);
    if (!item || !item.type.startsWith("AMBIGUOUS_") || item.status === "CLOSED" || !Object.hasOwn(TOOL_DESCRIPTIONS, event.tool) || event.tool === "inspect_vision_evidence") throw new Error("Invalid cloud evidence tool request");
    if (event.tool !== "get_cart_history" && event.input?.eventId !== item.eventId) throw new Error("Tool event must belong to the investigation case");
    return runAgentTool(structuredClone(store), event.tool, event.input || {});
  };
}

export function createAgentRuntime({ repository, planner = requestBedrockToolDecision, decision = requestLayaBasketDecision,
  statsPlanner = planStatsQuery, lambda = new LambdaClient({}), toolFunctionArn = process.env.TOOLS_FUNCTION_ARN,
} = {}) {
  return async input => {
    if (input?.type === "LIVE_VISION") {
      if (!/^[a-f0-9-]{36}$/.test(input.cameraSession || "") || typeof input.jpeg !== "string" || input.jpeg.length > 682668 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(input.jpeg)) throw new Error("Invalid live camera request");
      const jpeg = Buffer.from(input.jpeg, "base64");
      if (!jpeg.length || jpeg.length > 512000 || jpeg.toString("base64") !== input.jpeg) throw new Error("Invalid JPEG encoding");
      const response = await fetch("http://127.0.0.1:8001/live", { method: "POST", headers: { "content-type": "image/jpeg", "x-camera-session": input.cameraSession },
        body: jpeg, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Live YOLO inference unavailable");
      return response.json();
    }
    if (input?.type === "STAT_PLAN") return statsPlanner({ message: input.message, previousPlan: input.previousPlan, now: input.now });
    if (input?.type !== "CASE" || !/^CASE-\d+$/.test(input.caseId || "")) throw new Error("Invalid Agent runtime task");
    const { result } = await investigateStoredCase(repository, input.caseId, { provider: "bedrock", planner, decision,
      toolRunner: async (store, name, parameters, { signal }) => {
        if (name === "inspect_vision_evidence") return runAgentTool(store, name, parameters, { signal });
        if (!toolFunctionArn) throw new Error("TOOLS_FUNCTION_ARN is required");
        const response = await lambda.send(new InvokeCommand({ FunctionName: toolFunctionArn, Payload: Buffer.from(JSON.stringify({ caseId: input.caseId, tool: name, input: parameters })) }), { abortSignal: signal });
        if (response.FunctionError) throw new Error("Evidence Lambda failed");
        return JSON.parse(Buffer.from(response.Payload).toString());
      },
    });
    return { caseId: result.caseId, nextAction: result.nextAction, status: result.status };
  };
}

export function serveAgentRuntime(run, { port = 8080, host = "0.0.0.0", ready = () => true, secret = process.env.AGENT_INVOKE_SECRET } = {}) {
  if (process.env.AGENT_HOSTING === "apprunner" && (!secret || secret.length < 32)) throw new Error("Agent invocation secret is required");
  let active = 0;
  return createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.method === "GET" && request.url === "/ping") return send(ready() ? 200 : 503, { status: active ? "HealthyBusy" : "Healthy" });
    if (request.method !== "POST" || request.url !== "/invocations") return send(404, { error: "Not found" });
    if (secret) {
      const expected = Buffer.from("Bearer " + secret), provided = Buffer.from(request.headers.authorization || "");
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(401, { error: "Unauthorized" });
    }
    if (!ready()) return send(503, { error: "Models warming up" });
    active++;
    try {
      let body = "";
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 700000) throw new Error("Invocation too large"); }
      const input = JSON.parse(body);
      if (input?.type !== "LIVE_VISION" && Buffer.byteLength(body) > 4096) throw new Error("Invocation too large");
      send(200, await run(input));
    } catch (error) {
      console.error(JSON.stringify({ event: "AGENT_RUNTIME_FAILED", message: error.message }));
      send(503, { error: "Agent runtime unavailable; staff review required" });
    } finally { active--; }
  }).listen(port, host);
}

let tools;
export async function toolsHandler(event) {
  tools ||= createCloudToolsHandler(createRepository({ backend: "dynamodb-records", tableName: process.env.STATE_TABLE }));
  return tools(event);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const repository = createRepository({ backend: "dynamodb-records", tableName: process.env.STATE_TABLE });
  serveAgentRuntime(createAgentRuntime({ repository }));
}
