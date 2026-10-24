import type { NextRequest } from "next/server";
import { readCameraFrame } from "@/lib/camera-request";
import { cloudVisionProxy } from "@/lib/cloud-proxy";

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_CLOUD_MODE === "true") return cloudVisionProxy(request);
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_ENABLE_MOCK_AUTH !== "true") {
    return Response.json({ error: "Live camera is available in local dev:mock only" }, { status: 404 });
  }
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const parsed = new URL(origin || "");
    sameOrigin = ["http:", "https:"].includes(parsed.protocol) && parsed.host === request.headers.get("host");
  } catch { /* Missing or malformed Origin is rejected. */ }
  if (!sameOrigin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const frame = await readCameraFrame(request);
  if (frame instanceof Response) return frame;
  try {
    const endpoint = new URL("/live", process.env.VISION_ENDPOINT || "http://127.0.0.1:8001/infer");
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "image/jpeg", "x-camera-session": frame.session },
      body: new Uint8Array(frame.jpeg), cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]) });
    if (response.status === 404) return Response.json({ error: "YOLO ที่เปิดอยู่ยังเป็นโค้ดเดิม กรุณารีสตาร์ต npm run model:vision" }, { status: 503 });
    return Response.json(await response.json(), { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "YOLO ไม่พร้อม กรุณาเปิดหรือรีสตาร์ต npm run model:vision" }, { status: 503 });
  }
}
