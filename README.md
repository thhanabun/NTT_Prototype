# Basketly — Hybrid Smart-Basket Prototype

A two-basket, two-lane retail demo. A shelf event updates a shopper cart only when the deterministic policy can identify an active basket with clear evidence. Ambiguous or missing evidence stays pending and requires customer or staff confirmation. The amount shown at checkout includes confirmed items only.

The [primary IoT roadmap](docs/iot-roadmap.md) sets the hardware: ESP32-WROOM-32, KW11-N/KW12 roller microswitches and iBeacon Bluetooth IP67 tags. The `codex/fsm-iotcore` branch sends shelf events through AWS IoT Core to a local bridge and the existing deterministic cart FSM.

## Run locally

Requirements: Node.js 20+ and Python 3.12 recommended. Work in the codex/fsm-iotcore checkout. The HTTP server now selects real Laya inference by default. Install Node dependencies with npm ci, and start the model service in a separate terminal:

    powershell -NoProfile -File scripts/start-laya.ps1 -Install

After the first setup, npm run model:laya starts the cached model. Then start the app in another terminal:

    npm start

Open http://127.0.0.1:3000. The web app and API are served by the same Node process; EventSource streams state changes to both views. Demo state and case audit are persisted to the ignored data/demo-state.json file. Use the reset button to clear the local demo.

1. In Shopper app, choose Basket A and select Start shopping. A URL with ?basket=A can also start a session, which is the payload expected on a basket QR.
2. Open Staff dashboard and use the simulator controls. Select Coke or Water to choose a shelf lane.
3. Try Clear pick, then Ambiguous pick. Return to Shopper app and confirm YES or choose NO to route it to staff.
4. Try Low agent confidence or Unknown zone and resolve the case from Staff dashboard.
5. Send a confirmed pick followed by Put back. Send Duplicate delivery to verify the same event ID is ignored.
6. Mock checkout is enabled only for an active session with confirmed lines and no unresolved case affecting that basket. No payment is processed.

The QR camera uses the browser BarcodeDetector API where available and accepts a QR containing a URL parameter basket=A or basket=B. The two basket buttons are the manual fallback for browsers without native QR scanning.

## Next.js Shopper and Staff app

The integrated frontend is in `web/` on port 3001; the API remains on port 3000. Run `npm ci` and `npm run dev:mock` in `web/` after starting the model and API above. `LOCAL_API_ORIGIN` selects the backend. See [web/README.md](web/README.md). Admin login is an explicitly enabled local simulation; it is not API authorization.

## Safety policy

The HTTP server now uses a model-directed evidence loop for ambiguous cases: Laya chooses tools/allowlisted analysis scripts, observes their results and chooses again. Admin displays the selection trace and tool results. See [Agentic investigation and mock evidence scenarios](docs/agentic-investigation.md). Set `AGENT_MODE=workflow` to compare the previous fixed-tool path.

- A clear RSSI lead of at least 10 dB selects the nearest basket and bypasses the Agent. This is an initial demo threshold; calibrate it on the physical shelf.
- RSSI inside that margin is ambiguous. Laya runs a real typed decision after the evidence tools; a person must confirm before the item reaches the cart. Model errors route to staff without a mock fallback. Set AGENT_PROVIDER=mock explicitly only for a software simulation.
- Missing RSSI, tied evidence, a missing session, or a cart conflict routes to staff review.
- No pending case contributes to a payable total. An unresolved case with no basket candidate blocks both baskets until staff closes it.
- Duplicate event IDs are idempotent. PUT_BACK never makes a cart quantity negative.
- BLE is treated as proximity evidence, not proof of who picked up an item.

## Prototype architecture

The local harness gives the team a testable vertical slice while AWS credentials and the parts are being prepared:

    Browser PWA ── HTTP API + Server-Sent Events ── Node domain/FSM ── local JSON or DynamoDB
                                                       ↑
                                               event simulator

The implemented device path is:

    ESP32 ── MQTT/TLS ── AWS IoT Core ── local MQTT bridge ── POST /api/events ── deterministic FSM
                                               └── application ACK after local API success

The longer-term hosted target remains:

    AWS IoT Core ── Lambda ── DynamoDB / API Gateway / Step Functions / Bedrock

| Area | Prototype source in this repository | AWS target from the plan |
| --- | --- | --- |
| Shopper and staff UI | Next.js Shopper/Staff in web/; original PWA retained on port 3000 | Next.js App Router, TypeScript, TailwindCSS, shadcn/ui |
| Local event/API runtime | Node.js standard library, Server-Sent Events | API Gateway, Lambda, AppSync or API Gateway WebSocket |
| Transaction policy | Deterministic FSM in src/domain.mjs | Lambda + Step Functions Standard |
| Ambiguous-case decision | Real self-hosted Laya by default in the HTTP server; Jev and explicit mock remain optional | Same Laya API as a read-only tool called by an agent using a Bedrock foundation model |
| State | Local JSON by default; opt-in DynamoDB versioned state store | DynamoDB records and transactional workflows |
| Shelf device and transport | ESP32 Arduino firmware + local IoT bridge | AWS IoT Core MQTT/TLS |
| Staff login | Explicit development-only mock login; production Admin disabled | Cognito |
| Payment | Mock order only | No real payment in prototype |

The local app does not require AWS in its default mode. Set `STORE_BACKEND=dynamodb` to use the DynamoDB adapter; create the table and grant the app's AWS identity access first, following [the DynamoDB setup](infra/dynamodb/README.md). The AWS bridge uses MQTT.js. AWS IoT resources/certificates, firmware compilation/flash and physical calibration still need to be completed locally. No real certificates are included. This path does not deploy Lambda, API Gateway, Step Functions or Bedrock.

To use Jev for ambiguous cases, set `AGENT_PROVIDER=jev` and `TYPESAFE_API_KEY` in the server environment before `npm start`. `TYPESAFE_MODEL` optionally selects a model; the default is `jev-latest`. Jev receives only the case event, basket evidence, and cart/session history. Its recommendation is advisory: the local policy requires an active session, a matching RSSI candidate, confidence of at least 0.75, and no delayed-event or PUT_BACK conflict before asking the customer. Invalid responses, API errors, and timeouts fail closed to staff review. The key stays on the server and is never sent to the PWA.

The Laya checkpoint, weight hash and Python runtime versions are pinned in infra/laya/model.json and requirements-laya.txt. Run npm run verify:laya against the running model for a real HTTP/DB/HITL/audit check. It writes data/laya-live-report.json and keeps isolated demo state; model responses are not injected. npm test covers errors and contract guards using fixtures.

Run `npm run verify:full-flow` for the signal path over real local MQTT/TCP: scripted hardware -> production bridge -> compute/FSM -> actual Laya -> HITL/cart/DB/audit and two SSE clients. It also runs the Lambda handlers locally and checks slow-model retries, the real client timeout, malformed signals, restart and checkout. See [the full-flow check and its coverage boundaries](docs/full-flow-test.md). Aedes is a test-only development dependency; this does not test or deploy AWS IoT Core.

The initial real-model sample did not reliably distinguish all three A/B/tie scenarios, so model correctness is not an acceptance claim. The deterministic policy kept every uncertain result in staff review. See [local-to-cloud model choices and limits](docs/local-to-bedrock.md) before moving to AWS.

The local app uses the Node.js standard library in local JSON mode. DynamoDB mode uses AWS SDK for JavaScript v3; the optional IoT bridge uses MQTT.js.

## Source layout

- src/domain.mjs — event validation, idempotency, cart FSM, case policy, HITL decisions and mock checkout.
- src/application.mjs — application service shared by the HTTP API and integration tests.
- src/server.mjs — localhost HTTP API, static PWA host and realtime event stream.
- src/store-repository.mjs — local JSON and optimistic-locking DynamoDB persistence adapters.
- web/ — Next.js Shopper, Staff dashboard, mock login and shared realtime API adapter.
- public/ — shopper and staff views, PWA manifest, native camera scanning and event simulator.
- firmware/esp32/local_shelf/local_shelf.ino and firmware/esp32/aws_shelf/aws_shelf.ino — ESP32 switch debounce, iBeacon RSSI median, bounded outbox and MQTT application-ACK retry.
- scripts/iot-bridge.mjs — AWS IoT Core MQTT-to-local-API bridge.
- infra/aws-iot/policies/ — restricted shelf-device and bridge policies.
- infra/dynamodb/ — encrypted on-demand state table, scoped IAM policy, and setup guide.
- infra/lambda/ — Lambda handlers for evidence/decision tools, shared real-model case manager, audit writer and validator.
- infra/bedrock/ — function schema and safety instructions for configuring a Bedrock Agent.
- infra/step-functions/ — Standard workflow definition for investigation, HITL callbacks, validation and audit close.
- src/agent/ — mock case manager and evidence tools shared by the local server and Lambda handlers.
- src/agent/jev.mjs — optional server-side Jev decision provider for ambiguous cases.
- src/agent/laya.mjs — real Laya HTTP client; bounded typed input and selected-option probability.
- src/agent/investigate-stored-case.mjs — the same investigation/policy path used by the app and cloud Lambda.
- infra/laya/ — pinned checkpoint manifest and container recipe for the same model in the cloud.
- src/logger.mjs — structured application logs for CloudWatch-compatible stdout collection.
- tests/domain.test.mjs — acceptance checks for clear/duplicate, ambiguous, low-confidence, missing-RSSI and PUT_BACK flows.
- tests/agent-tools.test.mjs and tests/integration-flow.test.mjs — Lambda contract checks and bridge-to-cart/HITL/audit integration flow.
- tests/store-repository.test.mjs — local persistence and DynamoDB optimistic-write checks.
- docs/event-contract.md — shared device/API event contract and deterministic decision table.

## Delivery phases

| Phase | State in this implementation |
| --- | --- |
| 1 · Software first | Local simulator, event API, cart, shopper view, staff monitor and live updates implemented. |
| 2 · Agentic flow | Real local Laya inference, evidence tools, audit and HITL/validator run locally. The same Laya adapter is exposed by the Lambda decision tool. Bedrock orchestration and AWS deployment remain future work; the model's retail decision accuracy still needs evaluation. |
| 3 · Hardware / IoT | Firmware and MQTT bridge source cover two switch lanes and two iBeacon basket tags. AWS resources/certificates, compile/flash and physical end-to-end checks remain. |
| 4 · Audit and stability | Local case timeline and software acceptance tests are included. The 20–30 physical cycles, AWS retention/budget controls and CloudTrail checks remain hardware/cloud work. |
| 5 · Demo freeze | Rehearse the three journeys in this PWA. Cloud deployment, physical failure rehearsal and backup video are not performed from this workspace. |

## Optional DynamoDB mode

The same API and FSM can use DynamoDB for persistence. This prototype stores the compact application state in one versioned item and uses conditional writes to prevent lost updates. Local JSON remains the default. See [DynamoDB setup and limits](infra/dynamodb/README.md) before switching modes.

## Check the software acceptance rules

    npm test

The tests use Node's built-in test runner. For physical acceptance, repeat PICK/PUT_BACK for Coke and Water, inject sensor bounce and duplicate MQTT deliveries, move both tags near one another, remove one tag, then verify that no unresolved line is chargeable and event-to-screen latency stays under 1.5 seconds.

## Next cloud implementation checkpoint

Provision the DynamoDB table and scoped application access using [the DynamoDB guide](infra/dynamodb/README.md), then provision the IoT Thing, least-privilege policies and separate X.509 certificates using [the AWS IoT guide](infra/aws-iot/README.md). Lambda handler packaging, Bedrock Agent setup and Step Functions task-token callbacks still need AWS resource configuration; see [the Lambda guide](infra/lambda/README.md). Compile and flash the firmware for a physical end-to-end run.


Hardware PR integration review and actual verification results: [hardware protocol review](docs/hardware-protocol-review.md). The old smart_shelf.ino entry point is replaced by separate local/AWS sketches; esp32.ino delegates to the local implementation. Configure the current secrets.example.h before building.

Full local integration and verification: [system integration report](docs/system-integration.md).
