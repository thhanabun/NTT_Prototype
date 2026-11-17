import { shopperTools } from "./tools.mjs";

const problem = (status, message) => Object.assign(new Error(message), { status });
let runtimeClient;

function toBedrockMessages(messages) {
  const system = [], result = [];
  let toolResults = [];
  const append = (role, content) => {
    const previous = result.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else result.push({ role, content });
  };
  const flush = () => {
    if (toolResults.length) append("user", toolResults), toolResults = [];
  };
  for (const message of messages) {
    if (message.role === "system") { system.push({ text: message.content }); continue; }
    if (message.role === "tool") {
      toolResults.push({ toolResult: { toolUseId: message.tool_call_id, content: [{ text: message.content }], status: "success" } });
      continue;
    }
    flush();
    const content = message.content == null ? [] : [{ text: message.content }];
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        let input;
        try { input = JSON.parse(call.function.arguments); } catch { throw problem(502, "Agent tool arguments are invalid"); }
        content.push({ toolUse: { toolUseId: call.id, name: call.function.name, input } });
      }
    }
    append(message.role === "assistant" ? "assistant" : "user", content);
  }
  flush();
  return { system, messages: result };
}

export async function requestBedrockShopperCompletion({ messages, tools, signal, env = process.env, client }) {
  const modelId = env.BEDROCK_MODEL_ID;
  if (!modelId) throw problem(503, "Shopper Agent Bedrock model is not configured");
  if (Buffer.byteLength(JSON.stringify({ messages, tools })) > 28000) throw problem(413, "ข้อมูลสำหรับคำถามนี้ยาวเกินขอบเขต กรุณาเริ่มบทสนทนาใหม่");

  const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  client ||= runtimeClient ||= new BedrockRuntimeClient({});
  const conversation = toBedrockMessages(messages);
  const availableTools = tools || (messages.some(message => message.role === "assistant" && message.tool_calls?.length) ? shopperTools : undefined);
  const toolConfig = availableTools && {
    tools: availableTools.map(({ function: item }) => ({ toolSpec: { name: item.name, description: item.description, inputSchema: { json: {
      type: item.parameters.type,
      properties: Object.fromEntries(Object.entries(item.parameters.properties).map(([name, property]) => [name, { type: property.type, ...(property.description ? { description: property.description } : {}) }])),
      ...(item.parameters.required.length ? { required: item.parameters.required } : {}),
    } } } })),
    ...(tools && env.SHOPPER_AGENT_REQUIRE_TOOLS === "true" ? { toolChoice: { any: {} } } : { toolChoice: { auto: {} } }),
  };
  let response;
  try {
    response = await client.send(new ConverseCommand({ modelId, ...conversation, inferenceConfig: { maxTokens: 384, temperature: 0 }, ...(toolConfig ? { toolConfig } : {}) }), { abortSignal: signal });
  } catch (error) {
    if (signal?.aborted) throw problem(504, "Shopper Agent ใช้เวลานานเกินไป กรุณาลองใหม่");
    throw problem(503, "เชื่อมต่อโมเดล Bedrock Shopper Agent ไม่สำเร็จ กรุณาลองใหม่ภายหลัง");
  }

  const blocks = response.output?.message?.content;
  if (!Array.isArray(blocks) || !["tool_use", "end_turn"].includes(response.stopReason)) throw problem(502, "Bedrock ส่งคำตอบไม่ครบหรือไม่ตรงรูปแบบที่รองรับ");
  const uses = blocks.filter(block => block.toolUse).map(({ toolUse }) => ({ id: toolUse.toolUseId, type: "function", function: { name: toolUse.name, arguments: JSON.stringify(toolUse.input) } }));
  const requestedTools = response.stopReason === "tool_use";
  if (requestedTools !== Boolean(uses.length)) throw problem(502, "Bedrock ส่งการเรียกเครื่องมือไม่ตรงกับสถานะคำตอบ");
  const inputTokens = response.usage?.inputTokens, outputTokens = response.usage?.outputTokens;
  return {
    model: modelId,
    message: { role: "assistant", content: uses.length ? null : blocks.filter(block => typeof block.text === "string").map(block => block.text).join(""), ...(uses.length ? { tool_calls: uses } : {}) },
    usage: Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens) ? { inputTokens, outputTokens } : null,
  };
}
