# Local model and AWS migration contract

Updated 17 November 2026. The historical model comparison below is retained; the current deployment snapshot is in [cloud-deployment-status.md](cloud-deployment-status.md).

## Model roles

Use Laya typed-decisions as the local decision provider. It is a real 421M-parameter, non-generative, open-weight model under Apache-2.0. The local machine runs the model service; Hugging Face supplies the weights rather than paid hosted inference.

The checkpoint is pinned to convaiinnovations/laya, subfolder typed-decisions, revision 7b928d828b7b0e022f929d9bd2e44165aa270148. The downloaded 842,609,220-byte safetensors file was SHA256-verified; infra/laya/model.json and the launch/container configurations pin the same artifact.

Laya is a decision component: code gathers the evidence tools, Laya scores A/B/NONE, and deterministic policy decides customer confirmation versus staff review. Laya does not choose or execute tools itself.

## Runtime paths

Local:

    Simulated/ESP32 event -> FSM -> evidence tools -> real Laya HTTP
      -> deterministic policy -> customer/staff HITL -> validator -> JSON DB + audit + PWA

AWS target:

    IoT Core / API -> Lambda + deterministic FSM -> Step Functions
      -> private Agent Lambda: Bedrock Converse chooses allowed evidence actions
      -> local Laya typed decision + YOLO evidence tools -> policy/HITL/validator
      -> DynamoDB + audit + WebSocket/BFF

    Shopper Agent API -> Bedrock Converse + validated read-only tools

The deployed Cloud stack bundles the same pinned Laya service and YOLO runtime inside a private Agent Lambda container; the model service listens only on container loopback. Shopper Agent calls Bedrock Converse from the API Lambda. Preserve the model revision, input projection, answer labels, probability semantics, confidence threshold and validator rules when rebuilding. Cloud compute and Bedrock inference incur AWS charges.

The shared request is POST /v1/systemone with state and questions.basket (choice A, B or NONE). Full session IDs and unrelated orders are excluded to keep sensor evidence within the token budget. Selected-option probability is the policy score: Laya's field named confidence measures normalized entropy, so copying Jev's threshold onto that field would change its meaning. Neither score is validated as a probability of physical ownership on this store.

The local app and case-manager Lambda use src/agent/investigate-stored-case.mjs. The Bedrock action-group Lambda exposes get_basket_decision using src/agent/decision-tool.mjs and the same HTTP adapter. The outer Bedrock orchestrator must copy the tool's candidate/probability rather than generate a new confidence value. Cart mutation still requires the deterministic validator and a human decision.

## Bedrock model options

| Model | Local availability | Bedrock role |
| --- | --- | --- |
| Laya typed-decisions | Open weights; current real local provider | Not a native catalog model. Keep as an HTTP tool/service to retain the same model. |
| Amazon Nova Micro | No local open weights | Candidate small text orchestrator; not the deployed model in this stack. Verify account and regional availability before selecting it. |
| Amazon Nova Lite | No local open weights | Deployed Bedrock Converse model/inference profile: `apac.amazon.nova-lite-v1:0`. The private agent sends structured tool-selection prompts; YOLO handles image inference separately. |
| Meta Llama 3.2 3B Instruct | Can be self-hosted under its model license | Native Bedrock model and an alternative if identical local/cloud generative weights are required. It would need a separate adapter and evaluation; it is not the selected Laya provider. |

Do not assume Laya can be uploaded through Bedrock Custom Model Import: its ModernBERT plus custom decision-head architecture is not on the documented supported architecture list. Hosting a service that an agent calls is the migration route chosen here.

AgentCore was considered but the NTT deployment role lacked `iam:PassRole` for `bedrock-agentcore.amazonaws.com`. The project uses a private Lambda container plus Bedrock Converse and allowlisted tools instead; it does not require AgentCore permissions. The stack is deployed, while full Cloud investigation/HITL acceptance remains to be recorded. See [NTT access notes](ntt-cloud-access-request.md) and [Cloud status](cloud-deployment-status.md).

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
