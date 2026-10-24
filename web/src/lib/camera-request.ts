export async function readCameraFrame(request: Request): Promise<{ jpeg: Buffer; session: string } | Response> {
  const session = request.headers.get("x-camera-session") || "";
  if (!/^[a-f0-9-]{36}$/.test(session) || request.headers.get("content-type") !== "image/jpeg") return Response.json({ error: "Expected camera session and JPEG" }, { status: 400 });
  if (Number(request.headers.get("content-length")) > 512000) return Response.json({ error: "Frame too large" }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing frame" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512000) { await reader.cancel(); return Response.json({ error: "Frame too large" }, { status: 413 }); }
    chunks.push(value);
  }
  return size ? { jpeg: Buffer.concat(chunks), session } : Response.json({ error: "Empty frame" }, { status: 400 });
}
