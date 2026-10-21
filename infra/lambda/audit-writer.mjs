import { addAuditEntry } from "../../src/domain.mjs";
import { createRepository } from "../../src/store-repository.mjs";

let repository;

function getRepository() {
  repository ||= createRepository({
    backend: "dynamodb",
    tableName: process.env.DYNAMODB_TABLE_NAME,
  });
  return repository;
}

export function createAuditWriterHandler({ getStore = () => getRepository() } = {}) {
  return async function handler(event) {
    const action = String(event?.action || "").trim();
    const actor = String(event?.actor || "WORKFLOW").trim();
    if (!action) throw new Error("action is required");
    const { result: entry } = await getStore().mutate((store) =>
      addAuditEntry(store, action, actor, event.details || {}));
    console.log(JSON.stringify({
      timestamp: entry.at,
      level: "INFO",
      event: "AUDIT_ENTRY_WRITTEN",
      auditId: entry.auditId,
      action: entry.action,
      actor: entry.actor,
    }));
    return entry;
  };
}

export const handler = createAuditWriterHandler();
