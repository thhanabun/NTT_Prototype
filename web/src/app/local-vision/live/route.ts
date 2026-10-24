export async function POST(request: Request) {
  // Local camera frames never bypass the cloud staff authorization boundary.
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_CLOUD_MODE === "true" || process.env.NEXT_PUBLIC_ENABLE_MOCK_AUTH !== "true") {
    return Response.json({ error: "Live camera is available in local dev:mock only" }, { status: 404 });
  }
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const parsed = new URL(origin || "");
    sameOrigin = ["http:", "https:"].includes(parsed.protocol) && parsed.host === request.headers.get("host");
  } catch { /* Missing or malformed Origin is rejected. */ }
  if (!sameOrigin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const session = request.headers.get("x-camera-session") || "";
  if (!/^[a-f0-9-]{36}$/.test(session) || request.headers.get("content-type") !== "image/jpeg") {
    return Response.json({ error: "Expected camera session and JPEG" }, { status: 400 });
  }
  if (Number(request.headers.get("content-length")) > 512_000) return Response.json({ error: "Frame too large" }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing frame" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512_000) { await reader.cancel(); return Response.json({ error: "Frame too large" }, { status: 413 }); }
    chunks.push(value);
  }
  if (!size) return Response.json({ error: "Empty frame" }, { status: 400 });
  try {
    const endpoint = new URL("/live", process.env.VISION_ENDPOINT || "http://127.0.0.1:8001/infer");
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "image/jpeg", "x-camera-session": session },
      body: Buffer.concat(chunks), cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]) });
    if (response.status === 404) return Response.json({ error: "YOLO ที่เปิดอยู่ยังเป็นโค้ดเดิม กรุณารีสตาร์ต npm run model:vision" }, { status: 503 });
    return Response.json(await response.json(), { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "YOLO ไม่พร้อม กรุณาเปิดหรือรีสตาร์ต npm run model:vision" }, { status: 503 });
  }
}
