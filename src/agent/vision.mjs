const LIMITATION = "Object detections are supporting evidence only; they do not identify SKU, Basket A/B ownership, or PICK/PUT_BACK. Detection confidence is not basket confidence.";

export async function inspectVisionEvidence(store, { eventId } = {}, {
  endpoint = process.env.VISION_ENDPOINT || "http://127.0.0.1:8001/infer", fetchImpl = fetch, signal,
} = {}) {
  const event = store.events.find(item => item.eventId === eventId);
  if (!event) throw new Error("Source event not found");
  const records = (store.cameraEvidence || []).filter(item => item.eventId === eventId && item.frameId).slice(0, 2);
  if (!records.length) return { status: "NO_DATA", eventId, frames: [], limitation: LIMITATION };
  const frames = [];
  try {
    for (const record of records) {
      const response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ frameId: record.frameId }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Vision service HTTP ${response.status}`);
      const result = await response.json();
      const { width, height } = result.imageSize || {};
      if (result.status !== "AVAILABLE" || result.model !== "yolo11n" || result.frameId !== record.frameId ||
          !["MOCK", "CAMERA"].includes(result.source) || !/^[a-f0-9]{64}$/.test(result.weightsSha256) || !/^[a-f0-9]{64}$/.test(result.frameSha256) ||
          !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 16_000_000 ||
          !Number.isFinite(result.inferenceMs) || result.inferenceMs < 0 ||
          !Array.isArray(result.detections) || result.detections.length > 20 || result.detections.some(item =>
            !Number.isInteger(item.classId) || item.classId < 0 || item.classId > 79 || typeof item.label !== "string" || item.label.length > 80 ||
            !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 || !Array.isArray(item.box) || item.box.length !== 4 ||
            item.box.some((value, index) => !Number.isFinite(value) || value < 0 || value > (index % 2 ? height : width)) || item.box[0] > item.box[2] || item.box[1] > item.box[3])) throw new Error("Invalid vision service response");
      frames.push({ frameId: result.frameId, source: record.source === "MOCK" || result.source === "MOCK" ? "MOCK" : "CAMERA",
        cameraId: record.cameraId, linkedAt: record.receivedAt, aligned: false,
        model: result.model, weightsSha256: result.weightsSha256, frameSha256: result.frameSha256,
        imageSize: result.imageSize, inferenceMs: result.inferenceMs, detections: result.detections });
    }
    return { status: "AVAILABLE", eventId, frames, limitation: LIMITATION };
  } catch (error) {
    signal?.throwIfAborted();
    return { status: "UNAVAILABLE", eventId, frames: [], reason: error.message, limitation: LIMITATION };
  }
}
