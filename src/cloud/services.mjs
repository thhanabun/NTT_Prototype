import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand } from "@aws-sdk/client-sfn";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CloudWatchLogsClient, DescribeLogGroupsCommand, PutRetentionPolicyCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDbRecordsRepository } from "./records-repository.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const seconds = () => Math.floor(Date.now() / 1000);
const transientRealtimeCodes = new Set(["EBUSY", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"]);
const isTransientRealtimeError = error => transientRealtimeCodes.has(error.code) || [429, 500, 502, 503, 504].includes(error.$metadata?.httpStatusCode);
export function createCloudServices(env = process.env) {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const repository = new DynamoDbRecordsRepository({ tableName: env.STATE_TABLE, documentClient });
  const step = new SFNClient({}), secrets = new SecretsManagerClient({}), agent = new LambdaClient({});
  const control = env.CONTROL_TABLE;
  let keyPromise, verifier, realtimeClient, lastRealtimeWarningAt = 0;
  async function get(key) { return (await documentClient.send(new GetCommand({ TableName: control, Key: { id: key }, ConsistentRead: true }))).Item; }
  async function put(item, options = {}) { await documentClient.send(new PutCommand({ TableName: control, Item: item, ...options })); return item; }
  async function scan(filter, projection) {
    const items = []; let cursor;
    do { const response = await documentClient.send(new ScanCommand({ TableName: control, ExclusiveStartKey: cursor, ProjectionExpression: projection })); items.push(...(response.Items || []).filter(filter)); cursor = response.LastEvaluatedKey; } while (cursor);
    return items;
  }
  async function invokeAgent(payload) {
    const event = { version: "2.0", routeKey: "POST /invocations", rawPath: "/invocations", rawQueryString: "",
      headers: { "content-type": "application/json", host: "agent.internal" },
      requestContext: { accountId: env.AGENT_FUNCTION_ARN?.split(":")[4], apiId: "agent", domainName: "agent.internal", domainPrefix: "agent",
        requestId: randomUUID(), routeKey: "POST /invocations", stage: "$default", time: new Date().toISOString(), timeEpoch: Date.now(),
        http: { method: "POST", path: "/invocations", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "FAST Lambda API" } },
      body: JSON.stringify(payload), isBase64Encoded: false };
    const response = await agent.send(new InvokeCommand({ FunctionName: env.AGENT_FUNCTION_ARN, Payload: Buffer.from(JSON.stringify(event)) }),
      { abortSignal: AbortSignal.timeout(payload.type === "LIVE_VISION" ? 10000 : payload.type === "STAT_PLAN" ? 28000 : 240000) });
    if (response.FunctionError) throw new Error("Agent Lambda unavailable");
    const http = JSON.parse(Buffer.from(response.Payload).toString());
    if (http.statusCode !== 200) throw new Error("Agent runtime unavailable");
    const value = JSON.parse(http.isBase64Encoded ? Buffer.from(http.body, "base64").toString() : http.body);
    if (value.error) throw new Error(value.error);
    return value;
  }
  return {
    repository, get, put, scan, demoSignalsEnabled: env.ENABLE_DEMO_SIGNALS === "true",
    async key() {
      keyPromise ||= secrets.send(new GetSecretValueCommand({ SecretId: env.SESSION_SECRET_ARN })).then(result => {
        if (!result.SecretString || result.SecretString.length < 32) throw new Error("Invalid cloud session signing secret");
        return result.SecretString;
      }).catch(error => { keyPromise = undefined; throw error; });
      return keyPromise;
    },
    async verifyJwt(token) {
      verifier ||= CognitoJwtVerifier.create({ userPoolId: env.USER_POOL_ID, tokenUse: "access", clientId: env.USER_POOL_CLIENT_ID });
      return verifier.verify(token);
    },
    async startWorkflow(caseItem) {
      const name = `case-${caseItem.caseId}-${hash(caseItem.eventId).slice(0, 20)}`;
      try { return await step.send(new StartExecutionCommand({ stateMachineArn: env.WORKFLOW_ARN, name, input: JSON.stringify({ caseId: caseItem.caseId, investigate: caseItem.type.startsWith("AMBIGUOUS_") }) })); }
      catch (error) { if (error.name !== "ExecutionAlreadyExists") throw error; return { duplicate: true }; }
    },
    async resume(token, output) {
      try { await step.send(new SendTaskSuccessCommand({ taskToken: token, output: JSON.stringify(output) })); }
      catch (error) { if (!["TaskTimedOut", "TaskDoesNotExist"].includes(error.name)) throw error; }
    },
    async acknowledge(shelfId, eventId) {
      const client = new IoTDataPlaneClient({ endpoint: "https://" + env.IOT_DATA_ENDPOINT });
      await client.send(new PublishCommand({ topic: `smartbasket/shelf/${shelfId}/acks`, qos: 1, payload: Buffer.from(eventId) }));
    },
    async ticket(principal) {
      const ticket = randomBytes(32).toString("base64url");
      const connectionExpiresAt = Math.min(principal.exp || seconds() + 600, seconds() + 3600);
      await put({ id: "TICKET#" + hash(ticket), role: principal.role, expiresAt: seconds() + 60, ttl: seconds() + 120, connectionExpiresAt });
      return { ticket, expiresIn: 60, connectionExpiresAt };
    },
    async connect(ticket, connectionId) {
      if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Invalid realtime ticket");
      const id = "TICKET#" + hash(ticket);
      const record = await get(id);
      if (!record || record.expiresAt <= seconds()) throw new Error("Realtime ticket expired");
      // Atomic deletion makes the ticket single-use, including concurrent connects.
      await documentClient.send(new DeleteCommand({ TableName: control, Key: { id }, ConditionExpression: "expiresAt > :now", ExpressionAttributeValues: { ":now": seconds() } }));
      await put({ id: "CONNECTION#" + connectionId, connectionId, expiresAt: record.connectionExpiresAt, ttl: record.connectionExpiresAt });
    },
    async disconnect(connectionId) { await documentClient.send(new DeleteCommand({ TableName: control, Key: { id: "CONNECTION#" + connectionId } })); },
    async broadcast() {
      const client = realtimeClient ||= new ApiGatewayManagementApiClient({ endpoint: env.WS_MANAGEMENT_ENDPOINT });
      const connections = await scan(item => item.id.startsWith("CONNECTION#"), "id, connectionId, expiresAt");
      for (const connection of connections) {
        if (connection.expiresAt <= seconds()) { await documentClient.send(new DeleteCommand({ TableName: control, Key: { id: connection.id } })); continue; }
        const command = new PostToConnectionCommand({ ConnectionId: connection.connectionId, Data: Buffer.from('{"type":"STATE_CHANGED"}') });
        let deliveryError;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { await client.send(command); deliveryError = undefined; break; }
          catch (error) {
            deliveryError = error;
            if (attempt || !isTransientRealtimeError(error)) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        if (!deliveryError) continue;
        if (deliveryError.name === "GoneException" || deliveryError.$metadata?.httpStatusCode === 410) {
          await documentClient.send(new DeleteCommand({ TableName: control, Key: { id: connection.id } }));
          continue;
        }
        if (isTransientRealtimeError(deliveryError)) {
          if (Date.now() - lastRealtimeWarningAt >= 60_000) {
            lastRealtimeWarningAt = Date.now();
            console.warn("Skipped a transient WebSocket notification failure; state remains available through the API", { code: deliveryError.code, status: deliveryError.$metadata?.httpStatusCode });
          }
          continue;
        }
        throw deliveryError;
      }
    },
    async archive(records) {
      const client = new S3Client({});
      for (const record of records) {
        const key = record.dynamodb?.Keys?.stateKey?.S;
        if (!["INSERT", "MODIFY"].includes(record.eventName) || !/^STATE#(auditLog|events|cases|orders)#/.test(key || "")) continue;
        await client.send(new PutObjectCommand({ Bucket: env.ARCHIVE_BUCKET, Key: "business/" + key.replaceAll("#", "/") + "/" + record.dynamodb.SequenceNumber + ".json", ContentType: "application/json", Body: JSON.stringify(record) }));
      }
    },
    async retention() {
      const client = new CloudWatchLogsClient({});
      const prefixes = [env.WEB_LOG_GROUP, env.AGENT_LOG_GROUP].filter(Boolean);
      if (prefixes.length !== 2) throw new Error("Missing owned log group configuration");
      for (const prefix of prefixes) {
        let nextToken;
        do {
          const groups = await client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, nextToken }));
          for (const group of groups.logGroups || []) if (group.logGroupName.startsWith(prefix) && group.retentionInDays !== 14) await client.send(new PutRetentionPolicyCommand({ logGroupName: group.logGroupName, retentionInDays: 14 }));
          nextToken = groups.nextToken;
        } while (nextToken);
      }
    },
    invokeAgent,
  };
}
