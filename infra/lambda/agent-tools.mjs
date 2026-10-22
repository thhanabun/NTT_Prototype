import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { runAgentTool } from "../../src/agent/tools.mjs";
import { getBasketDecision } from "../../src/agent/decision-tool.mjs";
import { requestLayaBasketDecision } from "../../src/agent/laya.mjs";

const STATE_KEY = "SMART_BASKET#STATE";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
}));

function readParameters(parameters) {
  if (!Array.isArray(parameters)) return parameters && typeof parameters === "object" ? parameters : {};
  return Object.fromEntries(parameters.map(({ name, value }) => [name, value]));
}

function bedrockResponse(event, functionName, result) {
  return {
    messageVersion: "1.0",
    response: {
      actionGroup: event.actionGroup || "SmartBasketEvidence",
      function: functionName,
      functionResponse: {
        responseBody: { TEXT: { body: JSON.stringify(result) } },
      },
    },
    sessionAttributes: event.sessionAttributes || {},
    promptSessionAttributes: event.promptSessionAttributes || {},
  };
}

export function createAgentToolsHandler({
  documentClient = client,
  tableName = process.env.DYNAMODB_TABLE_NAME,
  decision = requestLayaBasketDecision,
} = {}) {
  return async function handler(event) {
    if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required");
    const functionName = event?.function || event?.toolName;
    if (!functionName) throw new Error("Bedrock function name is required");
    const { Item } = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { stateKey: STATE_KEY },
      ConsistentRead: true,
    }));
    if (!Item?.data) throw new Error("Prototype state record was not found");

    const parameters = readParameters(event.parameters);
    const result = functionName === "get_basket_decision"
      ? await getBasketDecision(Item.data, parameters, decision)
      : await runAgentTool(Item.data, functionName, parameters);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      event: "AGENT_TOOL_COMPLETED",
      tool: functionName,
      caseId: readParameters(event.parameters).caseId || null,
    }));
    return bedrockResponse(event, functionName, result);
  };
}

export const handler = createAgentToolsHandler();
