import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDbRepository, LocalJsonRepository } from "../src/store-repository.mjs";
import { startSession } from "../src/domain.mjs";

test("local repository serializes concurrent writes and reloads persisted sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smart-basket-store-"));
  const path = join(dir, "nested", "state.json");
  try {
    const repository = new LocalJsonRepository(path);
    await repository.init();
    await Promise.all([
      repository.mutate((store) => startSession(store, "A")),
      repository.mutate((store) => startSession(store, "B")),
    ]);

    const restarted = new LocalJsonRepository(path);
    const store = await restarted.init();
    assert.equal(store.sessions.length, 2);
    assert.ok(store.activeSessions.A);
    assert.ok(store.activeSessions.B);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DynamoDB repository retries optimistic conflicts without losing concurrent updates", async () => {
  class FakeDocumentClient {
    item = null;

    async send(command) {
      if (command instanceof GetCommand) {
        return { Item: this.item ? structuredClone(this.item) : undefined };
      }
      assert.ok(command instanceof PutCommand);
      const { ConditionExpression, ExpressionAttributeValues, Item } = command.input;
      if (ConditionExpression.includes("attribute_not_exists")) {
        if (this.item) throw conditionalFailure();
      } else if (this.item?.version !== ExpressionAttributeValues[":version"]) {
        throw conditionalFailure();
      }
      this.item = structuredClone(Item);
      return {};
    }
  }

  const documentClient = new FakeDocumentClient();
  const repository = new DynamoDbRepository({ tableName: "test-state", documentClient });
  await repository.init();
  await Promise.all([
    repository.mutate((store) => startSession(store, "A")),
    repository.mutate((store) => startSession(store, "B")),
  ]);

  assert.equal(documentClient.item.version, 3);
  assert.equal(documentClient.item.data.sessions.length, 2);
  assert.ok(documentClient.item.data.activeSessions.A);
  assert.ok(documentClient.item.data.activeSessions.B);
});

function conditionalFailure() {
  const error = new Error("Conditional request failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}
