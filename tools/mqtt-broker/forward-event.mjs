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

export async function forwardTelemetry(payload, { apiOrigin, shelfId, fetchImpl = fetch, log = console.error }) {
  try {
    const sample = JSON.parse(payload.toString());
    if (!sample || typeof sample !== "object" || sample.shelfId !== shelfId) throw new Error("Telemetry shelfId must match its MQTT topic");
    const response = await fetchImpl(new URL("/api/telemetry", apiOrigin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return true;
  } catch (error) { log("Telemetry not ingested: " + error.message); return false; }
}
