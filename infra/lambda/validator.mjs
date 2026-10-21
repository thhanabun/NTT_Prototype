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

export function createValidatorHandler({ getStore = () => getRepository() } = {}) {
  return async function handler(event) {
    const caseId = event?.caseId || event?.decision?.caseId;
    if (!caseId) throw new Error("caseId is required");
    const { result } = await getStore().mutate((store) => {
      const caseItem = store.cases.find((item) => item.caseId === caseId);
      const valid = Boolean(caseItem?.status === "CLOSED" && caseItem.resolution);
      const validation = {
        caseId,
        valid,
        status: caseItem?.status || "NOT_FOUND",
        message: valid ? "Human decision is closed and recorded." : "Case is unresolved or has no recorded resolution.",
      };
      addAuditEntry(store, valid ? "CASE_VALIDATION_PASSED" : "CASE_VALIDATION_FAILED", "VALIDATOR", validation);
      return validation;
    });
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: result.valid ? "INFO" : "WARN",
      event: result.valid ? "CASE_VALIDATION_PASSED" : "CASE_VALIDATION_FAILED",
      ...result,
    }));
    return result;
  };
}

export const handler = createValidatorHandler();
