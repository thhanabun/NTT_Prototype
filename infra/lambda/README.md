# Agent and audit Lambda source

These handlers share the same domain and DynamoDB aggregate as the local prototype. They are source-ready, but this repository does not deploy the Lambda functions or Step Functions state machine automatically.

| Handler | Purpose | Input |
| --- | --- | --- |
| `infra/lambda/agent-tools.handler` | Bedrock function action group; reads the state item and calls one read-only evidence tool | Bedrock function event with `function` and `parameters` |
| `infra/lambda/case-manager.handler` | Uses the same real Laya investigation and deterministic policy as the local app | `{ "caseId": "CASE-001" }` |
| `infra/lambda/audit-writer.handler` | Appends a bounded audit entry to the DynamoDB state | `{ "action": "...", "actor": "...", "details": {} }` |
| `infra/lambda/validator.handler` | Confirms a case has a recorded closed resolution | `{ "caseId": "CASE-001" }` |

Set `DYNAMODB_TABLE_NAME` and `AWS_REGION` on each function. Package the repository root so the `src/` imports and `package.json` dependencies stay available; configure the handler path exactly as shown above. Give read-only access to the evidence-tools function and `GetItem`/`PutItem` access to the other functions. The audit log is capped at 500 entries in this demo state item.

The case manager defaults to AGENT_PROVIDER=laya with the model-directed evidence loop (eight actions, 25-second investigation budget). Set AGENT_MODE=workflow for the previous fixed-tool path. Allow additional Lambda runtime for DynamoDB IO and cold starts. See docs/agentic-investigation.md for tool/collector contracts and remaining deployment boundaries. Set LAYA_ENDPOINT to the cloud-hosted copy of the same decision service and supply LAYA_API_KEY for an authenticated service. The explicit AGENT_PROVIDER=mock mode remains available for fixture checks; failed real inference routes to staff.

The get_basket_decision tool calls the same Laya adapter without changing any cart. The function schema/response wrapper is for Bedrock Agents Classic. New AWS customers should use AgentCore and expose the shared tool through a Gateway/tool wrapper; see docs/local-to-bedrock.md. The outer Bedrock agent is not deployed or invoked by the local app.

`../step-functions/case-workflow.asl.json` is the Standard workflow contract. Its input supplies `caseId` plus the Lambda ARNs named in the definition. Customer/staff approval tasks use the Step Functions task-token callback pattern; customer confirmation times out after 120 seconds and routes to staff. The hosted customer/staff API still needs to persist the token and call `SendTaskSuccess`. The local PWA already exercises customer and staff decisions directly against the deterministic domain functions, but does not resume an AWS state-machine task.

The functions emit one JSON log record per invocation/action to stdout for Lambda's CloudWatch log stream. They do not create CloudWatch log groups, retention rules, alarms, Bedrock resources, or state-machine IAM roles.
