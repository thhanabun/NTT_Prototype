export const DEVICE_TIMEOUT_MS = 5000;

// Device telemetry describes current hardware; shelf events remain immutable transaction evidence.
export function deviceState(store, now = Date.now()) {
  const sample = (store.telemetry || []).find(item => item.shelfId === store.shelf.shelfId && item.source === "DEVICE");
  const ageMs = sample ? Math.max(0, now - Date.parse(sample.receivedAt)) : null;
  const fresh = sample && Number.isFinite(ageMs) && ageMs <= DEVICE_TIMEOUT_MS;
  return {
    status: !sample ? "UNKNOWN" : fresh ? "ONLINE" : "OFFLINE",
    lastSeenAt: sample?.receivedAt || null,
    source: sample?.source || null,
    timeoutMs: DEVICE_TIMEOUT_MS,
    rssi: fresh ? sample.rssi : { A: null, B: null, HV01: null },
    lanes: fresh ? sample.lanes : [],
    uptimeMs: fresh ? sample.uptimeMs : null,
    queueDepth: fresh ? sample.queueDepth : null,
    droppedEvents: fresh ? sample.droppedEvents : null,
  };
}
