const problem = (status, message) => Object.assign(new Error(message), { status });

export function shopperModelConfig(env = process.env) {
  if (!env.SHOPPER_AGENT_BASE_URL || !env.SHOPPER_AGENT_MODEL) throw problem(503, "Shopper Agent ยังไม่ได้ตั้งค่า endpoint และชื่อโมเดล กรุณาติดต่อผู้ดูแล หรือเปิดโหมด demo สำหรับทดสอบในเครื่อง");
  let base;
  try { base = new URL(env.SHOPPER_AGENT_BASE_URL); } catch { throw problem(503, "Shopper Agent endpoint configuration is invalid"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw problem(503, "Shopper Agent endpoint configuration is invalid");
  return { url: base.href.replace(/\/+$/, "") + "/chat/completions", model: env.SHOPPER_AGENT_MODEL, apiKey: env.SHOPPER_AGENT_API_KEY };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw problem(502, "โมเดลส่งคำตอบว่าง กรุณาลองใหม่");
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64000) { await reader.cancel(); throw problem(502, "คำตอบจากโมเดลมีขนาดเกินขอบเขต"); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error.status) throw error;
    throw problem(502, "โมเดลส่งรูปแบบคำตอบที่อ่านไม่ได้");
  } finally { reader.releaseLock(); }
}

export async function requestShopperCompletion({ messages, tools, signal, env = process.env, fetchImpl = fetch }) {
  const config = shopperModelConfig(env);
  if (Buffer.byteLength(JSON.stringify({ messages, tools })) > 28000) throw problem(413, "ข้อมูลสำหรับคำถามนี้ยาวเกินขอบเขต กรุณาเริ่มบทสนทนาใหม่");
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, messages, stream: false, max_tokens: 384,
        ...(tools ? { tools, tool_choice: "auto" } : {}) }),
    });
  } catch {
    if (signal?.aborted) throw problem(504, "Shopper Agent ใช้เวลานานเกินไป กรุณาลองใหม่");
    throw problem(503, "เชื่อมต่อโมเดล Shopper Agent ไม่สำเร็จ กรุณาลองใหม่ภายหลัง");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw problem(502, "โมเดล Shopper Agent ไม่พร้อมใช้งาน กรุณาตรวจการตั้งค่าหรือลองใหม่ภายหลัง");
  }
  const payload = await boundedJson(response);
  const message = payload?.choices?.[0]?.message;
  if (!message || message.role !== "assistant" || payload.choices[0].finish_reason === "length") throw problem(502, "โมเดลส่งคำตอบไม่ครบหรือไม่ตรงรูปแบบที่รองรับ");
  const usage = payload.usage;
  return { message, model: config.model, usage: usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0
    ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : null };
}
