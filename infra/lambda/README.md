# Agent and audit Lambda source

These handler modules share domain/evidence logic with the local prototype. The integrated deployment in [`infra/cloud`](../cloud/README.md) packages and deploys the Cloud API, IoT ingest, Agent, tools, validator, audit, handoff and reconciliation functions plus Step Functions. This folder's individual handler examples are not a separate deployment path. Current AWS resource status is in [Cloud deployment status](../../docs/cloud-deployment-status.md).

| Handler | Purpose | Input |
| --- | --- | --- |
| `infra/lambda/agent-tools.handler` | Bedrock function action group; reads the state item and calls one read-only evidence tool | Bedrock function event with `function` and `parameters` |
| `infra/lambda/case-manager.handler` | Uses the same real Laya investigation and deterministic policy as the local app | `{ "caseId": "CASE-001" }` |
| `infra/lambda/audit-writer.handler` | Appends a bounded audit entry to the DynamoDB state | `{ "action": "...", "actor": "...", "details": {} }` |
| `infra/lambda/validator.handler` | Confirms a case has a recorded closed resolution | `{ "caseId": "CASE-001" }` |

Set `DYNAMODB_TABLE_NAME` and `AWS_REGION` on each function. Package the repository root so the `src/` imports and `package.json` dependencies stay available; configure the handler path exactly as shown above. Give read-only access to the evidence-tools function and `GetItem`/`PutItem` access to the other functions. The audit log is capped at 500 entries in this demo state item.

The case manager defaults to AGENT_PROVIDER=laya with the model-directed evidence loop (eight actions, 25-second investigation budget). Set AGENT_MODE=workflow for the previous fixed-tool path. Allow additional Lambda runtime for DynamoDB IO and cold starts. See docs/agentic-investigation.md for tool/collector contracts and remaining deployment boundaries. Set LAYA_ENDPOINT to the cloud-hosted copy of the same decision service and supply LAYA_API_KEY for an authenticated service. The explicit AGENT_PROVIDER=mock mode remains available for fixture checks; failed real inference routes to staff.

The `get_basket_decision` adapter remains a read-only Laya decision tool for compatibility and local checks. The deployed Cloud runtime uses a private Lambda container and Bedrock Converse with allowlisted action selection; it does not depend on AgentCore or the Classic agent resource. See [model migration notes](../../docs/local-to-bedrock.md).

`../step-functions/case-workflow.asl.json` is the Standard workflow definition used by the Cloud stack. Customer/staff decisions use the Step Functions task-token callback pattern; customer confirmation times out and routes to staff. The local PWA resolves cases directly against the local domain and does not exercise AWS task tokens. Cloud deployment is complete, but the full live AWS case path still needs end-to-end acceptance.

The functions emit one JSON log record per invocation/action to stdout for Lambda's CloudWatch log stream. They do not create CloudWatch log groups, retention rules, alarms, Bedrock resources, or state-machine IAM roles.
