# Local model and AWS migration contract

Checked 21 October 2026. Working checkout: codex/fsm-iotcore.

## Model roles

Use Laya typed-decisions as the local decision provider. It is a real 421M-parameter, non-generative, open-weight model under Apache-2.0. The local machine runs the model service; Hugging Face supplies the weights rather than paid hosted inference.

The checkpoint is pinned to convaiinnovations/laya, subfolder typed-decisions, revision 7b928d828b7b0e022f929d9bd2e44165aa270148. The downloaded 842,609,220-byte safetensors file was SHA256-verified; infra/laya/model.json and the launch/container configurations pin the same artifact.

Laya is a decision component: code gathers the evidence tools, Laya scores A/B/NONE, and deterministic policy decides customer confirmation versus staff review. Laya does not choose or execute tools itself.

## Runtime paths

Local:

    Simulated/ESP32 event -> FSM -> evidence tools -> real Laya HTTP
      -> deterministic policy -> customer/staff HITL -> validator -> JSON DB + audit + PWA

AWS target:

    IoT Core -> Lambda/FSM -> Step Functions -> agent using Bedrock Nova Micro
      -> read-only tools, including get_basket_decision -> same Laya HTTP service
      -> deterministic policy/HITL/validator -> DynamoDB + audit + PWA

Host the same Laya container on CPU compute such as ECS or EC2. Change LAYA_ENDPOINT to its reachable private endpoint. Preserve model revision, input projection, answer labels, probability semantics, confidence threshold and validator rules. The cloud compute and Bedrock inference have AWS charges.

The shared request is POST /v1/systemone with state and questions.basket (choice A, B or NONE). Full session IDs and unrelated orders are excluded to keep sensor evidence within the token budget. Selected-option probability is the policy score: Laya's field named confidence measures normalized entropy, so copying Jev's threshold onto that field would change its meaning. Neither score is validated as a probability of physical ownership on this store.

The local app and case-manager Lambda use src/agent/investigate-stored-case.mjs. The Bedrock action-group Lambda exposes get_basket_decision using src/agent/decision-tool.mjs and the same HTTP adapter. The outer Bedrock orchestrator must copy the tool's candidate/probability rather than generate a new confidence value. Cart mutation still requires the deterministic validator and a human decision.

## Bedrock model options

| Model | Local availability | Bedrock role |
| --- | --- | --- |
| Laya typed-decisions | Open weights; current real local provider | Not a native catalog model. Keep as an HTTP tool/service to retain the same model. |
| Amazon Nova Micro | No local open weights | Recommended small text orchestrator; Converse and tool calling supported. Model ID amazon.nova-micro-v1:0 where directly available. |
| Amazon Nova Lite | No local open weights | Alternative if the agent later needs image/video evidence; current prototype does not. |
| Meta Llama 3.2 3B Instruct | Can be self-hosted under its model license | Native Bedrock model and an alternative if identical local/cloud generative weights are required. It would need a separate adapter and evaluation; it is not the selected Laya provider. |

Do not assume Laya can be uploaded through Bedrock Custom Model Import: its ModernBERT plus custom decision-head architecture is not on the documented supported architecture list. Hosting a service that an agent calls is the migration route chosen here.

Bedrock Agents Classic closed to new customers on 30 July 2026. For a new account, target Bedrock AgentCore with a Bedrock foundation model and read-only tool bindings. Existing eligible Classic accounts can use the included function-details Lambda wrapper. AgentCore infrastructure, a live Bedrock orchestration loop, IAM and cloud deployment are not implemented or validated by the local check.

Model access and model IDs must be verified for the deployment account/region. The direct Nova Micro sample uses us-east-1; the existing app's DynamoDB region need not imply that the model is directly available there. Never copy a cross-region inference profile from another geography without checking account availability.

## Evidence and limits

Run npm run model:laya, then npm start. The HTTP server defaults to Laya. AGENT_PROVIDER=mock is an explicit simulation setting. If real inference is unavailable or malformed, provider LAYA is recorded as FAILED and the case routes to staff; no mock recommendation is substituted.

Run npm run verify:laya with the model service active. It starts an isolated real HTTP app, sends synthetic shelf signals, uses actual Laya responses, checks DB/audit/HITL and duplicate handling, and calls the cloud decision-tool handler locally. Its DynamoDB read is a fixture; no AWS deployment is claimed. Output: data/laya-live-report.json.

The initial three synthetic probes produced A for near-A (0.511), A for near-B (0.4584), and A for a tie (0.3932). The model's top choice agreed with the illustrative label in 1/3 probes; this tiny sample is not a benchmark. All three were sent to staff, including the incorrect recommendations. Integration and policy checks passed, while autonomous decision quality was not established. Do not lower the threshold to force the customer-confirmation demo. Evaluate representative shelf evidence and consider domain fine-tuning or another provider before relying on model recommendations.

## Primary references

- Laya model card and self-host API: https://huggingface.co/convaiinnovations/laya
- Laya server source, including confidence semantics: https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py
- Nova Micro, APIs, tool calling and regional availability: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html
- Nova Lite: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html
- Bedrock API/model compatibility: https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html
- Supported custom import architectures: https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html
- Agents Classic maintenance and AgentCore migration: https://docs.aws.amazon.com/bedrock/latest/userguide/agents-classic-maintenance-mode.html
- AgentCore can use external models and custom orchestration: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/using-any-model.html
