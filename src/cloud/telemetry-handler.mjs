import { normalizeTelemetry } from "../evidence.mjs";
import { SHELF_IDS } from "../shelves.mjs";
import { createCloudTelemetry } from "./telemetry.mjs";

export function createCloudTelemetryHandler(telemetry) {
  return async event => {
    const match = /^smartbasket\/shelf\/([A-Z0-9-]+)\/telemetry$/.exec(event.mqttTopic || "");
    if (!match || !SHELF_IDS.includes(match[1]) || event.mqttClientId !== match[1] || event.shelfId !== match[1]) throw new Error("IoT topic/client/shelf identity mismatch");
    const receipt = event.mqttReceivedAt;
    if (receipt === undefined) return { ok: true };
    if (!Number.isSafeInteger(receipt) || receipt <= 0 || receipt > Date.now() + 5000) throw new Error("Invalid IoT receipt timestamp");
    await telemetry.write(normalizeTelemetry({ ...event, source: "DEVICE" }, new Date(receipt).toISOString()));
    return { ok: true };
  };
}

let handler;
export async function ingest(event) {
  handler ||= createCloudTelemetryHandler(createCloudTelemetry(process.env.TELEMETRY_TABLE));
  return handler(event);
}
