function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function optionalCount(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function capturedTime(value, receivedAt) {
  if (!value) return { capturedAt: receivedAt, timeBasis: "SERVER_RECEIPT" };
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds > Date.parse(receivedAt) + 5000) throw new Error("Invalid capturedAt");
  return { capturedAt: new Date(milliseconds).toISOString(), timeBasis: "SOURCE_TIMESTAMP" };
}

export function ingestTelemetry(store, input, receivedAt = new Date().toISOString()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Telemetry must be an object");
  const rssiInput = input.rssi || input.baskets || {};
  const rssi = Object.fromEntries(["A", "B", "HV01"].map(id => {
    const value = rssiInput[id] ?? (id === "HV01" ? input.highValueItem?.rssi : null);
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < -127 || value > 0)) throw new Error("Invalid telemetry RSSI");
    return [id, value ?? null];
  }));
  if (input.lanes !== undefined && (!Array.isArray(input.lanes) || input.lanes.length > 2)) throw new Error("Invalid telemetry lanes");
  const lanes = (input.lanes || []).map(lane => {
    if (!["LANE-1", "LANE-2", "LANE-COKE", "LANE-WATER"].includes(lane.laneId) || typeof lane.present !== "boolean") throw new Error("Invalid lane state");
    return { laneId: lane.laneId, present: lane.present };
  });
  const sample = {
    shelfId: identifier(input.shelfId, "shelfId"), receivedAt,
    ...capturedTime(input.capturedAt || input.timestamp, receivedAt),
    source: input.source === "MOCK" ? "MOCK" : "DEVICE", rssi, lanes,
    uptimeMs: input.uptimeMs === undefined
      ? (optionalCount(input.uptime, "uptime") === null ? null : optionalCount(input.uptime * 1000, "uptimeMs"))
      : optionalCount(input.uptimeMs, "uptimeMs"),
    queueDepth: optionalCount(input.queueDepth, "queueDepth"),
    droppedEvents: optionalCount(input.droppedEvents, "droppedEvents"),
  };
  store.telemetry ||= [];
  store.telemetry.unshift(sample);
  store.telemetry = store.telemetry.slice(0, 120);
  return sample;
}

export function ingestCameraEvidence(store, input, receivedAt = new Date().toISOString()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Camera evidence must be an object");
  const event = store.events.find(item => item.eventId === input.eventId);
  if (!event) throw new Error("Camera evidence requires an existing eventId");
  if (!["CAMERA", "MOCK"].includes(input.source)) throw new Error("Camera source must be CAMERA or MOCK");
  if (!Array.isArray(input.observations) || input.observations.length < 1 || input.observations.length > 8 ||
      !input.observations.every(item => ["PICK_VISIBLE", "PUT_BACK_VISIBLE", "OCCLUDED", "INCONCLUSIVE"].includes(item))) throw new Error("Invalid camera observations");
  const sample = {
    eventId: event.eventId, shelfId: event.shelfId, laneId: event.laneId,
    cameraId: identifier(input.cameraId, "cameraId"), source: input.source,
    ...capturedTime(input.capturedAt, receivedAt), receivedAt,
    observations: [...new Set(input.observations)],
  };
  store.cameraEvidence ||= [];
  store.cameraEvidence.unshift(sample);
  store.cameraEvidence = store.cameraEvidence.slice(0, 20);
  return sample;
}
