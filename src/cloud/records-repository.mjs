import { createHash } from "node:crypto";
import { createStore } from "../domain.mjs";

export const META_KEY = "STATE#META";
const MAX_ITEM_BYTES = 240_000;
const digest = value => createHash("sha256").update(value).digest("base64url");
const encode = value => JSON.stringify(value);

// Keep domain arrays in separate records; a versioned manifest preserves their order.
export function stateRecords(store) {
  const records = new Map();
  const data = {}, arrays = {};
  for (const [field, value] of Object.entries(store)) {
    if (!Array.isArray(value)) { data[field] = value; continue; }
    arrays[field] = value.map(entry => {
      const idField = { cases: "caseId", events: "eventId", cloudReceipts: "eventId", orders: "orderId", auditLog: "auditId", sessions: "sessionId" }[field];
      const identity = idField ? entry[idField] : encode(entry);
      if (typeof identity !== "string" || !identity) throw new Error(`Missing ${field} record identity`);
      const key = `STATE#${field}#${digest(identity)}`;
      if (records.has(key)) throw new Error(`Duplicate ${field} record`);
      records.set(key, { stateKey: key, value: entry });
      return key;
    });
  }
  const meta = { stateKey: META_KEY, data, arrays };
  for (const item of [meta, ...records.values()]) {
    if (Buffer.byteLength(encode(item)) > MAX_ITEM_BYTES) throw new Error("Cloud state record exceeds 240 KB; archive history or reduce evidence before continuing");
  }
  return { meta, records };
}

export class DynamoDbRecordsRepository {
  constructor({ tableName, documentClient, initialStore = createStore }) {
    if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required");
    this.tableName = tableName; this.client = documentClient; this.initialStore = initialStore;
  }

  async sdk() {
    const sdk = await import("@aws-sdk/lib-dynamodb");
    if (!this.client) {
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      this.client = sdk.DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    }
    return sdk;
  }

  async meta() {
    const { GetCommand } = await this.sdk();
    return (await this.client.send(new GetCommand({ TableName: this.tableName, Key: { stateKey: META_KEY }, ConsistentRead: true }))).Item;
  }

  async init() { return this.read(); }

  async load() {
    const { BatchGetCommand } = await this.sdk();
    for (let attempt = 0; attempt < 6; attempt++) {
      const meta = await this.meta();
      if (!meta) return { store: this.initialStore(), version: 0, records: new Map() };
      const keys = Object.values(meta.arrays).flat();
      const records = new Map();
      for (let offset = 0; offset < keys.length; offset += 100) {
        let pending = { [this.tableName]: { Keys: keys.slice(offset, offset + 100).map(stateKey => ({ stateKey })), ConsistentRead: true } };
        for (let retry = 0; Object.keys(pending).length; retry++) {
          if (retry === 6) throw new Error("Cloud state read was throttled; retry the request");
          const result = await this.client.send(new BatchGetCommand({ RequestItems: pending }));
          for (const item of result.Responses?.[this.tableName] || []) records.set(item.stateKey, item);
          pending = result.UnprocessedKeys || {};
          if (Object.keys(pending).length) await new Promise(resolve => setTimeout(resolve, 20 * 2 ** retry));
        }
      }
      // Strong reads before and after detect any intervening atomic state transaction.
      if ((await this.meta())?.version !== meta.version) continue;
      if (keys.some(key => !records.has(key))) throw new Error("Cloud state is incomplete; refusing to reset or fabricate data");
      const store = structuredClone(meta.data);
      for (const [field, ids] of Object.entries(meta.arrays)) store[field] = ids.map(id => records.get(id).value);
      return { store, version: meta.version, records };
    }
    throw new Error("Cloud state changed repeatedly during read; retry the request");
  }

  async read() { return (await this.load()).store; }

  async mutate(mutator) {
    const { TransactWriteCommand } = await this.sdk();
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.load();
      const next = structuredClone(current.store);
      const result = mutator(next);
      if (result && typeof result.then === "function") throw new Error("State mutators must be synchronous and contain no external side effects");
      const { meta, records } = stateRecords(next);
      const changed = [];
      for (const [key, item] of records) if (encode(item) !== encode(current.records.get(key))) changed.push({ Put: { TableName: this.tableName, Item: item } });
      for (const key of current.records.keys()) if (!records.has(key)) changed.push({ Delete: { TableName: this.tableName, Key: { stateKey: key } } });
      const oldMeta = stateRecords(current.store).meta;
      if (current.version && !changed.length && encode(oldMeta) === encode(meta)) return { result, store: next };
      meta.version = current.version + 1;
      meta.updatedAt = new Date().toISOString();
      const transaction = [{ Put: { TableName: this.tableName, Item: meta,
        ConditionExpression: current.version ? "#version = :version" : "attribute_not_exists(stateKey)",
        ...(current.version ? { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":version": current.version } } : {}),
      } }, ...changed];
      // shortcut: one prototype transaction, archive before exceeding AWS transaction limits.
      if (transaction.length > 100 || Buffer.byteLength(encode(transaction)) > 3_500_000) throw new Error("State change exceeds the cloud transaction budget; use an archive/migration job");
      try {
        await this.client.send(new TransactWriteCommand({ TransactItems: transaction }));
        return { result, store: next };
      } catch (error) {
        if (error.name !== "TransactionCanceledException" || !error.CancellationReasons?.some(reason => ["ConditionalCheckFailed", "TransactionConflict"].includes(reason.Code))) throw error;
        await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }
    throw new Error("Cloud state write contention; retry with the same event/decision ID");
  }

  async replace(next) {
    return this.mutate(draft => { for (const key of Object.keys(draft)) delete draft[key]; Object.assign(draft, structuredClone(next)); return { ok: true }; });
  }
}
