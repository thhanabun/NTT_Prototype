import mqtt from "mqtt";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2] || "stable";
if (!["stable", "unstable", "bounce", "missing", "camera", "vision"].includes(scenario)) throw new Error("Scenario: stable | unstable | bounce | missing | camera | vision");
const api = process.env.LOCAL_API_ORIGIN || "http://127.0.0.1:3000";
const shelfId = "SHELF-01";
const eventId = "mock-evidence-" + crypto.randomUUID();
const client = await mqtt.connectAsync(process.env.MQTT_URL || "mqtt://127.0.0.1:1883", { connectTimeout: 5000, reconnectPeriod: 0 });
let heartbeat;
let ackTimer;
let counter = 0;
let picked = false;
const publish = (kind, value) => client.publishAsync(`smartbasket/shelf/${shelfId}/${kind}`, JSON.stringify(value), { qos: 1 });
const sample = () => {
  counter++;
  const rssi = scenario === "missing" ? { A: null, B: null } : scenario === "unstable"
    ? counter % 2 ? { A: -48, B: -73 } : { A: -73, B: -48 } : { A: -55, B: -57 };
  return { shelfId, source: "MOCK", capturedAt: new Date().toISOString(), uptimeMs: counter * 500, queueDepth: 0, droppedEvents: 0, rssi: { ...rssi, HV01: -63 }, lanes: [{ laneId: "LANE-1", present: !picked }, { laneId: "LANE-2", present: true }] };
};
try {
  await client.subscribeAsync(`smartbasket/shelf/${shelfId}/acks`);
  console.log(`Scenario ${scenario}; start Basket A/B sessions in Shopper first. Event: ${eventId}`);
  for (let i = 0; i < 5; i++) { await publish("telemetry", sample()); await delay(500); }
  heartbeat = setInterval(() => { void publish("telemetry", sample()).catch(error => console.error(error.message)); }, 500);
  const acknowledgement = new Promise((resolve, reject) => {
    ackTimer = setTimeout(() => reject(new Error("No application ACK within 40 seconds; inspect broker/API logs")), 40000);
    client.on("message", (_topic, payload) => { if (payload.toString() === eventId) { clearTimeout(ackTimer); resolve(); } });
  });
  // Attach the handler immediately while optional camera metadata is being ingested.
  acknowledgement.catch(() => {});
  const event = { eventId, shelfId, laneId: "LANE-1", sku: "COKE", eventType: "PICK", timestamp: new Date().toISOString(), rssi: scenario === "missing" ? { A: null, B: null } : { A: -55, B: -57 } };
  if (scenario === "vision") event.mockVisionFrameId = "demo-people";
  await publish("events", event);
  picked = true;
  if (scenario === "bounce") { await delay(40); await publish("events", { ...event, eventId: eventId + "-nearby", timestamp: new Date().toISOString() }); }
  if (scenario === "camera") {
    let stored = false;
    for (let i = 0; i < 15 && !stored; i++) {
      const response = await fetch(new URL("/api/evidence/camera", api), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, cameraId: "DEMO-CAM", source: "MOCK", capturedAt: event.timestamp, observations: ["OCCLUDED", "INCONCLUSIVE"] }), signal: AbortSignal.timeout(5000) });
      if (response.ok) stored = true;
      else if (response.status === 409) await delay(100);
      else throw new Error("Camera metadata ingestion failed: HTTP " + response.status);
    }
    if (!stored) throw new Error("Event was not available for camera metadata ingestion");
  }
  await acknowledgement;
  console.log("Application ACK received. Inspect Agentic investigation, tool results and cart in Staff/Shopper.");
} finally {
  clearInterval(heartbeat);
  clearTimeout(ackTimer);
  await client.endAsync();
}
