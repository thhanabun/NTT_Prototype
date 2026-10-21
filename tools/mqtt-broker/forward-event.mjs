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
