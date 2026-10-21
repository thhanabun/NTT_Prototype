import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mqtt from "mqtt";

export async function forwardShelfEvent(payload, {
  apiOrigin,
  publishAck,
  fetchImpl = fetch,
  log = console.error,
}) {
  let event;
  try {
    event = JSON.parse(payload.toString());
  } catch (error) {
    log("Rejected invalid JSON from IoT Core:", error.message);
    return false;
  }
  if (!event || typeof event !== "object" || Array.isArray(event) ||
    typeof event.eventId !== "string" || !event.eventId.trim()) {
    log("Rejected IoT event without an eventId");
    return false;
  }

  try {
    const response = await fetchImpl(new URL("/api/events", apiOrigin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Local API returned HTTP ${response.status}`);
    await publishAck(event.eventId);
    return true;
  } catch (error) {
    log(`IoT event ${event.eventId} was not acknowledged:`, error.message);
    return false;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function startIoTBridge({
  brokerUrl,
  connectionOptions = {},
  shelfId = "SHELF-01",
  apiOrigin = "http://127.0.0.1:3000",
  log = console.log,
  logError = console.error,
} = {}) {
  if (!brokerUrl) throw new Error("brokerUrl is required");
  if (!/^[A-Z0-9-]+$/.test(shelfId)) throw new Error("SHELF_ID must contain only A-Z, 0-9, and hyphens");

  const eventTopic = `smartbasket/shelf/${shelfId}/events`;
  const ackTopic = `smartbasket/shelf/${shelfId}/acks`;
  const client = mqtt.connect(brokerUrl, {
    clientId: `smartbasket-bridge-${shelfId}`,
    protocolVersion: 4,
    clean: false,
    keepalive: 30,
    reconnectPeriod: 1000,
    connectTimeout: 10000,
    ...connectionOptions,
  });

  client.on("connect", () => {
    client.subscribe(eventTopic, { qos: 1 }, (error) => {
      if (error) logError("IoT subscribe failed:", error.message);
      else log(`Subscribed to ${eventTopic}`);
    });
  });
  client.on("message", (topic, payload) => {
    if (topic !== eventTopic) return;
    void forwardShelfEvent(payload, {
      apiOrigin,
      publishAck: (eventId) => new Promise((resolveAck, rejectAck) => {
        client.publish(ackTopic, eventId, { qos: 1 }, (error) => error ? rejectAck(error) : resolveAck());
      }),
      log: logError,
    });
  });
  client.on("error", (error) => logError("IoT MQTT error:", error.message));
  client.on("reconnect", () => log("Reconnecting to IoT broker"));
  return client;
}

function start() {
  const client = startIoTBridge({
    brokerUrl: `mqtts://${required("AWS_IOT_ENDPOINT")}:8883`,
    shelfId: process.env.SHELF_ID || "SHELF-01",
    apiOrigin: process.env.LOCAL_API_ORIGIN || "http://127.0.0.1:3000",
    connectionOptions: {
      ...(process.env.AWS_IOT_CLIENT_ID ? { clientId: process.env.AWS_IOT_CLIENT_ID } : {}),
      ca: readFileSync(resolve(required("AWS_IOT_CA_FILE"))),
      cert: readFileSync(resolve(required("AWS_IOT_CERT_FILE"))),
      key: readFileSync(resolve(required("AWS_IOT_KEY_FILE"))),
    },
  });

  const shutdown = () => client.end(false, {}, () => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) start();
