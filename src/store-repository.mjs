import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createStore } from "./domain.mjs";

const STATE_KEY = "SMART_BASKET#STATE";
const MAX_WRITE_ATTEMPTS = 4;

function isValidStore(value) {
  return value && value.products && value.shelf && value.carts && value.cases;
}

export class LocalJsonRepository {
  constructor(path) {
    this.path = path;
    this.store = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8"));
      this.store = isValidStore(stored) ? stored : createStore();
    } catch {
      this.store = createStore();
    }
    return this.store;
  }

  async read() {
    if (!this.store) await this.init();
    return this.store;
  }

  async mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      const current = await this.read();
      const next = structuredClone(current);
      const result = mutator(next);
      if (result?.duplicate !== true || result?.auditOnly) await this.#save(next);
      this.store = next;
      return { result, store: this.store };
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async replace(next) {
    return this.mutate((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, structuredClone(next));
      return { ok: true };
    });
  }

  async #save(store) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(store), "utf8");
  }
}

export class DynamoDbRepository {
  constructor({ tableName, client, documentClient, initialStore = createStore }) {
    if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required for DynamoDB storage");
    this.tableName = tableName;
    this.client = documentClient || null;
    this.lowLevelClient = client || null;
    this.sdkPromise = null;
    this.initialStore = initialStore;
    this.store = null;
  }

  async init() {
    const record = await this.#readRecord();
    if (record) return this.#cache(record);

    const initial = this.initialStore();
    try {
      const { client, PutCommand } = await this.#sdk();
      await client.send(new PutCommand({
        TableName: this.tableName,
        Item: { stateKey: STATE_KEY, version: 1, updatedAt: new Date().toISOString(), data: initial },
        ConditionExpression: "attribute_not_exists(#stateKey)",
        ExpressionAttributeNames: { "#stateKey": "stateKey" },
      }));
      this.store = initial;
      return this.store;
    } catch (error) {
      if (error.name !== "ConditionalCheckFailedException") throw error;
      return this.#cache(await this.#readRecord());
    }
  }

  async read() {
    const record = await this.#readRecord();
    if (!record) return this.init();
    return this.#cache(record);
  }

  async mutate(mutator) {
    const { client, PutCommand } = await this.#sdk();
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.#readRecord();
      const currentStore = current?.data || this.initialStore();
      const next = structuredClone(currentStore);
      const result = mutator(next);

      if (result?.duplicate === true && !result?.auditOnly && current) {
        this.#cache(current);
        return { result, store: this.store };
      }

      const version = current?.version || 0;
      const item = {
        stateKey: STATE_KEY,
        version: version + 1,
        updatedAt: new Date().toISOString(),
        data: next,
      };
      try {
        await client.send(new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: current ? "#version = :version" : "attribute_not_exists(#stateKey)",
          ExpressionAttributeNames: current
            ? { "#version": "version" }
            : { "#stateKey": "stateKey" },
          ...(current ? { ExpressionAttributeValues: { ":version": current.version } } : {}),
        }));
        this.store = next;
        return { result, store: this.store };
      } catch (error) {
        if (error.name !== "ConditionalCheckFailedException") {
          if (error.name === "ValidationException" && /item size|400 KB|400KB/i.test(error.message)) {
            throw new Error("DynamoDB prototype state exceeded the 400 KB item limit; archive or split the state before continuing");
          }
          throw error;
        }
      }
    }
    throw new Error("DynamoDB state changed repeatedly; retry the request");
  }

  async replace(next) {
    return this.mutate((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, structuredClone(next));
      return { ok: true };
    });
  }

  async #readRecord() {
    const { client, GetCommand } = await this.#sdk();
    const result = await client.send(new GetCommand({
      TableName: this.tableName,
      Key: { stateKey: STATE_KEY },
      ConsistentRead: true,
    }));
    return result.Item || null;
  }

  #cache(record) {
    this.store = record.data;
    return this.store;
  }

  async #sdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = (async () => {
        const [{ DynamoDBClient }, { DynamoDBDocumentClient, GetCommand, PutCommand }] = await Promise.all([
          import("@aws-sdk/client-dynamodb"),
          import("@aws-sdk/lib-dynamodb"),
        ]);
        const lowLevelClient = this.lowLevelClient || new DynamoDBClient({
          region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-southeast-1",
          ...(process.env.DYNAMODB_ENDPOINT ? {
            endpoint: process.env.DYNAMODB_ENDPOINT,
            credentials: { accessKeyId: "local", secretAccessKey: "local" },
          } : {}),
        });
        return {
          client: this.client || DynamoDBDocumentClient.from(lowLevelClient, {
            marshallOptions: { removeUndefinedValues: true },
          }),
          GetCommand,
          PutCommand,
        };
      })();
    }
    return this.sdkPromise;
  }
}

export function createRepository({ backend, statePath, tableName }) {
  if (backend === "dynamodb") return new DynamoDbRepository({ tableName });
  if (backend && backend !== "local") throw new Error(`Unknown STORE_BACKEND: ${backend}`);
  return new LocalJsonRepository(statePath);
}
