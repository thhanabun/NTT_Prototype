# FAST cloud deployment status and history

## Current snapshot — 17 พ.ย. 2026

- Account: NTT Challenger Team 14 (`134250568427`), region Singapore (`ap-southeast-1`), stack `fast-prototype`.
- CloudFormation update completed. `WebService`, `AgentRuntime` and `ApiFunction` were `Active` / `Successful` at the post-deploy check.
- Web/Admin: <https://syryfs6jflfyqbskcrp425zdfq0ocuqy.lambda-url.ap-southeast-1.on.aws/admin>; Shopper: <https://syryfs6jflfyqbskcrp425zdfq0ocuqy.lambda-url.ap-southeast-1.on.aws/shopper>.
- API Gateway HTTP: `https://22k71qppag.execute-api.ap-southeast-1.amazonaws.com`; realtime WebSocket: `wss://fbvi7lhah0.execute-api.ap-southeast-1.amazonaws.com/live`.
- IoT is enabled. `SHELF-01`, `SHELF-02` and `SHELF-03` each have an active certificate and attached device policy. This confirms provisioning only; it does not prove all three physical boards are flashed or pass end-to-end shelf tests.
- CloudWatch Lambda log retention is 14 days. The monthly AWS Budget is US$50 with an actual-cost notification at 80%; this is an alert, not a spending cap. The SNS alarm email subscription was still `PendingConfirmation` at the latest check, so confirm the AWS email to receive alarm notifications.
- Release tag: `fast-final-20261117-02b30d3-delta`. Web image digest: `sha256:08d61ae9d8d96d5730c71ef2f8c33a583df1011fadced40114e27b4e89707882`; Agent image digest: `sha256:fd4cfee0494209351b2572050cc9de572a4949d747357977b3b889134d01ed2f`.
- The release was built from `codex/cloud-without-iot` at `02b30d3` plus a local OAuth proxy change that was not committed at the time of deployment. The deployed image therefore is not reproducible from that commit alone. Do not treat this documentation commit as publishing that source change.

This is a resource/runtime check, **not full Cloud acceptance**. No physical IoT-to-cart run, complete shopper/staff journeys, camera session, live Stat Query, cost measurement or failure rehearsal was performed as part of this deployment check. AWS billed cost was not verified. See [Cloud acceptance](#acceptance-still-required) before claiming the entire system works end to end.

## Historical deployment record — 25 ต.ค. 2026

## Target

- Account: NTT Challenger Team 14 (`134250568427`), profile `ntt-fast`, Singapore `ap-southeast-1`
- Stack: `fast-prototype`; image bootstrap: `fast-prototype-images`
- Runtime: Next.js Lambda Function URL; private Agent Lambda with Laya typed-decisions and YOLO11n; Bedrock Converse `apac.amazon.nova-lite-v1:0`
- API Gateway HTTP/WebSocket, Lambda FSM/tools, DynamoDB, Step Functions Standard, Cognito STAFF, S3, CloudWatch, CloudTrail and monthly budget alert US$50
- IoT was disabled at initial deployment and enabled in a later stack update. Read-only CloudFormation check on 25 Oct 2026 found `EnableIoT=true`, three IoT Things, one device policy and one topic rule. The user reported the IoT signal path passed; this report does not retain per-device acceptance artifacts. Authenticated Admin simulator remains enabled. Local demo DB, services and ESP firmware are preserved.

## Deployment record

1. NTT Identity Center + MFA and STS verified the target account.
2. AgentCore PassRole was not allowed. App Runner CreateService also failed actual PassRole despite the generic simulation being allowed. No SSO permissions were changed.
3. Changed hosting to Lambda containers via AWS Lambda Web Adapter 1.1.0. Both amd64 images built and pushed successfully.
4. Actual Lambda creation revealed the account limit of 3,008 MB; Agent memory was reduced to that limit. Failed stack containers were removed only after rollback; retained DB/archive/secret resources were preserved in ignored `data/cloud-recovery-retained.json`.
5. Stack creation and Cognito callback update completed. HTTPS `/admin/login` and `/shopper` returned 200. Laya startup exposed owner-only HF cache file permissions under Lambda UID; the image now grants read/traverse access to bundled model files.
6. An actual Bedrock Converse tool-selection readiness request returned HTTP 403 `AccessDeniedException`: AWS account verification is pending (request ID `af7887ef-5e60-4bbd-8553-129b6170c9e3`). Model availability/entitlement APIs had returned available, which did not guarantee inference. This was an external account activation blocker; it cleared on the subsequent readiness check recorded below.

## Checks already completed

- Production Next.js build, TypeScript, modified-file ESLint and Node/PowerShell syntax checks
- Generated CloudFormation/SAM template validation and cfn-lint
- Shared Lambda ZIP build and ECR image build/push
- No additional test suite was run during this deployment task. Historical fixture results are documented separately in `infra/cloud/README.md` and do not prove AWS end-to-end acceptance.

## Activation

The demo account `admin@basketly.test` was provisioned in Cognito and added to `STAFF`; no password is printed or stored in this document. Use the Cognito password-setting script below to set a private password for the account before continued use. The local mock login and AWS Cognito are separate authentication paths.

```powershell
.\.venv-cloud\Scripts\python.exe scripts/set-cloud-staff-password.py --email admin@basketly.test
```

The optional password-change script checks the AWS account, prompts for a new Cognito password privately, suppresses email delivery and adds the user to `STAFF`. The password is never written to arguments, files or Git. This is a FAST application credential, separate from NTT SSO.

Already generated with `node scripts/cloud-pairing.mjs`:  Basket A/B URLs (`cloud-basket-urls.json`) and printable `cloud-basket-A.svg` / `cloud-basket-B.svg` QR labels in ignored `data/`. Keep pairing codes with the demo baskets. Confirm the SNS email subscription to receive alarms.

## Acceptance still required

Basket QR sessions, clear/ambiguous/Staff HITL flows, Bedrock investigation/tool execution through the deployed Agent, checkout, Stat Query, camera permission/inference, realtime reconnect, duplicate/retry behavior, latency and billing must be exercised on AWS before claiming full system acceptance. Cloud reset remains disabled. Payment is mock; camera positions still need physical calibration.

## Bedrock activation — resolved on 25 Oct 2026 (historical readiness check)

A subsequent actual Converse call using `ChallengerAccess` and the existing planner succeeded with model `apac.amazon.nova-lite-v1:0`, selecting the sole allowed action `STOP_STAFF`. Observed request duration was 1,738 ms (508 input / 78 output tokens). No customer data was sent and no cart/case was mutated. The account-verification denial is no longer the active blocker; no profile or IAM permission change was needed.

This checks actual model access and the tool-selection contract from the deployment machine. It does not prove that a full investigation through the deployed Agent execution role and Step Functions has passed.

## Verified 25 Oct deployment checkpoint (historical)

- At that checkpoint, CloudFormation `fast-prototype` was `UPDATE_COMPLETE`; Web and Agent Lambda were `Active` / `Successful`.
- Bedrock actual Converse readiness passed after the initial account-verification denial cleared.
- [Admin](https://syryfs6jflfyqbskcrp425zdfq0ocuqy.lambda-url.ap-southeast-1.on.aws/admin)
- [Shopper](https://syryfs6jflfyqbskcrp425zdfq0ocuqy.lambda-url.ap-southeast-1.on.aws/shopper)
- Existing FAST demo account signed in through Cognito/PKCE and loaded the Admin dashboard with backend state and realtime connected indicator.
- Private Agent `/ping`: HTTP 200 `Healthy` with both Laya/YOLO loaded after the cache permission fix. Measured cold invocation: **176.01 seconds**. This is startup readiness, not a model accuracy or full flow result.
- Anonymous `/api/state` returns an empty public scaffold by design; `/api/audit` returned 403. Source `scopedState()` controls that separation. Full cross-basket acceptance is still pending.
- Cognito callback exactly matches the deployed HTTPS origin.
- At that checkpoint, the stack had three `AWS::IoT::Thing` resources, one `AWS::IoT::Policy` and one `AWS::IoT::TopicRule`; all 12 Lambda log groups had 14-day retention.
- Historical release tag: `fast-lambda-cachefix-20261025`; its image digests are retained in the original deployment report and are superseded by the 17 Nov snapshot above.
- Ignored evidence: `data/cloud-agent-cachefix-health.json`, `data/cloud-config-health.json`, `data/cloud-bedrock-readiness.json`, `data/cloud-staff-setup.json` and `tmp/cloud-ui/fast-cloud-admin.png`.

Before a demo, run `.\.venv-cloud\Scripts\python.exe scripts/warm-cloud-agent.py`. It invokes the private read-only health route, validates the AWS account and waits for model initialization. Lambda can start a fresh environment later; warming once does not guarantee every later invocation is warm. Initial Stat Query/live camera calls can exceed their short request budgets during a cold start. No scheduled keep-warm resources were added.
