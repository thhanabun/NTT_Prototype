# FAST cloud deployment — 25 ต.ค. 2026

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

Per user request, the existing FAST demo account `admin@basketly.test` was provisioned in Cognito with the existing local demo password and `STAFF` group. No email was sent; no new password was recorded in deployment outputs. This demo password is present in the source and is suitable only for the temporary demonstration. To replace it with your own password, run:

```powershell
.\.venv-cloud\Scripts\python.exe scripts/set-cloud-staff-password.py --email admin@basketly.test
```

The optional password-change script checks the AWS account, prompts for a new Cognito password privately, suppresses email delivery and adds the user to `STAFF`. The password is never written to arguments, files or Git. This is a FAST application credential, separate from NTT SSO.

Already generated with `node scripts/cloud-pairing.mjs`:  Basket A/B URLs (`cloud-basket-urls.json`) and printable `cloud-basket-A.svg` / `cloud-basket-B.svg` QR labels in ignored `data/`. Keep pairing codes with the demo baskets. Confirm the SNS email subscription to receive alarms.

## Acceptance still required

Basket QR sessions, clear/ambiguous/Staff HITL flows, Bedrock investigation/tool execution through the deployed Agent, checkout, Stat Query, camera permission/inference, realtime reconnect, duplicate/retry behavior, latency and billing must be exercised on AWS before claiming full system acceptance. Cloud reset remains disabled. Payment is mock; camera positions still need physical calibration.

## Bedrock activation — resolved on 25 Oct 2026

A subsequent actual Converse call using `ChallengerAccess` and the existing planner succeeded with model `apac.amazon.nova-lite-v1:0`, selecting the sole allowed action `STOP_STAFF`. Observed request duration was 1,738 ms (508 input / 78 output tokens). No customer data was sent and no cart/case was mutated. The account-verification denial is no longer the active blocker; no profile or IAM permission change was needed.

This checks actual model access and the tool-selection contract from the deployment machine. It does not prove that a full investigation through the deployed Agent execution role and Step Functions has passed.

## Verified final deployment

- CloudFormation `fast-prototype`: `UPDATE_COMPLETE`; latest resource inventory has no unfinished resources. Web and Agent Lambda are `Active` / `Successful`.
- Bedrock actual Converse readiness passed after the initial account-verification denial cleared.
- [Admin](https://syryfs6jflfyqbskcrp425zdfq0ocuqy.lambda-url.ap-southeast-1.on.aws/admin)
- [Shopper](https://syryfs6jflfyqbskcrp425zdfq0ocuqy.lambda-url.ap-southeast-1.on.aws/shopper)
- Existing FAST demo account signed in through Cognito/PKCE and loaded the Admin dashboard with backend state and realtime connected indicator.
- Private Agent `/ping`: HTTP 200 `Healthy` with both Laya/YOLO loaded after the cache permission fix. Measured cold invocation: **176.01 seconds**. This is startup readiness, not a model accuracy or full flow result.
- Anonymous `/api/state` returns an empty public scaffold by design; `/api/audit` returned 403. Source `scopedState()` controls that separation. Full cross-basket acceptance is still pending.
- Cognito callback exactly matches the deployed HTTPS origin.
- Current read-only inventory: three `AWS::IoT::Thing` resources, one `AWS::IoT::Policy` and one `AWS::IoT::TopicRule`; stack `EnableIoT=true`. CloudFormation status does not itself verify physical firmware flashing or per-shelf end-to-end acceptance. All 12 Lambda log groups have 14-day retention; retention handler returned `{ "ok": true }`.
- Release tag: `fast-lambda-cachefix-20261025`; Web digest `sha256:8a06cc0af896e13b8446906c7d74bb987fee93dae45402e29b8b82d46fd041d5`, Agent digest `sha256:05740914a3ceb922ce8088d916922df800c1f9be2062345e142eeae75b837a87`.
- Ignored evidence: `data/cloud-agent-cachefix-health.json`, `data/cloud-config-health.json`, `data/cloud-bedrock-readiness.json`, `data/cloud-staff-setup.json` and `tmp/cloud-ui/fast-cloud-admin.png`.

Before a demo, run `.\.venv-cloud\Scripts\python.exe scripts/warm-cloud-agent.py`. It invokes the private read-only health route, validates the AWS account and waits for model initialization. Lambda can start a fresh environment later; warming once does not guarantee every later invocation is warm. Initial Stat Query/live camera calls can exceed their short request budgets during a cold start. No scheduled keep-warm resources were added.
