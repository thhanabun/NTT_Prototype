// The device keeps/retries the event until this application ACK, not MQTT PUBACK.
export async function forwardShelfEvent(payload, { apiOrigin, publishAck, fetchImpl = fetch, log = console.error }) {
  let event;
  try { event = JSON.parse(payload.toString()); }
  catch { log("Rejected invalid JSON from shelf"); return false; }
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      typeof event.eventId !== "string" || !event.eventId.trim()) {
    log("Rejected shelf event without eventId");
    return false;
  }
  try {
    const response = await fetchImpl(new URL("/api/events", apiOrigin), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(event), signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    await publishAck(event.eventId);
    return true;
  } catch (error) {
    log("Shelf event " + event.eventId + " not acknowledged: " + error.message);
    return false;
  }
}

// Presence reports are frequent and disposable: no ACK, and per shelf only the
// latest report waits while a request is in flight, so a slow server never builds a queue.
export function createPresenceForwarder({ apiOrigin, fetchImpl = fetch, log = console.error, timeoutMs = 2000 }) {
  const url = new URL("/api/presence", apiOrigin);
  const inFlight = new Set();
  const waiting = new Map();
  let failing = false;

  async function send(shelfId, body) {
    inFlight.add(shelfId);
    try {
      const response = await fetchImpl(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body, signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      if (failing) log("Presence forwarding recovered");
      failing = false;
    } catch (error) {
      if (!failing) log("Presence forwarding failed: " + error.message);
      failing = true;
    } finally {
      inFlight.delete(shelfId);
    }
    const next = waiting.get(shelfId);
    if (next !== undefined) {
      waiting.delete(shelfId);
      await send(shelfId, next);
    }
  }

  return function forwardPresence(payload) {
    let report;
    try { report = JSON.parse(payload.toString()); }
    catch { return false; }
    if (!report || typeof report !== "object" || Array.isArray(report) ||
        typeof report.shelfId !== "string" || !report.shelfId.trim()) return false;
    const body = JSON.stringify(report);
    if (inFlight.has(report.shelfId)) {
      waiting.set(report.shelfId, body);
      return true;
    }
    void send(report.shelfId, body);
    return true;
  };
}
