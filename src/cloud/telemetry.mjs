import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { BLE_LOCATION_CONFIG } from "../ble-location-config.mjs";
import { updateBleLocation } from "../ble-location.mjs";
import { evidenceWindowCenter } from "../evidence.mjs";
import { SHELF_IDS } from "../shelves.mjs";

const HISTORY_SECONDS = 3600;
const LATEST = 0;
const newerFirst = (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt);

export function createCloudTelemetry(TableName, documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {
  return {
    async write(sample) {
      const { shelfId } = sample;
      const receivedAtMs = Date.parse(sample.receivedAt);
      await Promise.all([
        documentClient.send(new PutCommand({ TableName, Item: { shelfId, receiptKey: receivedAtMs, sample, ttl: Math.floor(receivedAtMs / 1000) + HISTORY_SECONDS } })),
        documentClient.send(new PutCommand({
          TableName, Item: { shelfId, receiptKey: LATEST, receivedAtMs, sample },
          ConditionExpression: "attribute_not_exists(receivedAtMs) OR receivedAtMs < :receivedAtMs",
          ExpressionAttributeValues: { ":receivedAtMs": receivedAtMs },
        })).catch(error => { if (error.name !== "ConditionalCheckFailedException") throw error; }),
      ]);
    },
    async latest(shelfId) {
      const { Item } = await documentClient.send(new GetCommand({ TableName, Key: { shelfId, receiptKey: LATEST }, ConsistentRead: true }));
      return Item?.sample;
    },
    async recent(shelfId, fromMs, toMs, Limit) {
      const now = Date.now();
      const from = Math.max(fromMs, now - HISTORY_SECONDS * 1000);
      if (!Number.isFinite(from) || !Number.isFinite(toMs) || from > toMs) return [];
      const { Items = [] } = await documentClient.send(new QueryCommand({
        TableName, ConsistentRead: true, Limit, ScanIndexForward: false,
        KeyConditionExpression: "shelfId = :shelfId AND receiptKey BETWEEN :from AND :to",
        ExpressionAttributeValues: { ":shelfId": shelfId, ":from": from, ":to": toMs },
      }));
      return Items.map(item => item.sample);
    },
  };
}

export async function attachDeviceTelemetry(store, telemetry, config = BLE_LOCATION_CONFIG) {
  const now = Date.now();
  const calibrated = Object.values(config.tags).some(tag => Number.isFinite(tag.enterRssiDbm) && Number.isFinite(tag.exitRssiDbm));
  const recent = await Promise.all(SHELF_IDS.map(async shelfId => {
    const latest = await telemetry.latest(shelfId);
    if (!latest) return [];
    if (!calibrated) return [latest];
    // shortcut: reconstruct experimental BLE hysteresis from bounded history, checkpoint it if long periods in the threshold deadband need to preserve older presence.
    const history = await telemetry.recent(shelfId, now - 120_000, Date.parse(latest.receivedAt), 120);
    return history.length && history[0].receivedAt === latest.receivedAt ? history : [latest, ...history];
  }));
  const samples = recent.flat().sort(newerFirst);
  store.telemetry = [...samples, ...(store.telemetry || [])].sort(newerFirst);
  if (calibrated && samples.length) {
    const replay = { telemetry: [], bleLocationState: structuredClone(store.bleLocationState) };
    for (const sample of [...store.telemetry].reverse()) {
      replay.telemetry.unshift(sample);
      updateBleLocation(replay, Date.parse(sample.receivedAt), config);
    }
    store.bleLocationState = replay.bleLocationState;
  }
}

export async function attachEvidenceTelemetry(store, telemetry, event, windowMs) {
  const center = evidenceWindowCenter(event);
  const samples = await telemetry.recent(event.shelfId, center - windowMs, center + windowMs, 24);
  store.telemetry = [...samples, ...(store.telemetry || [])].sort(newerFirst);
}
