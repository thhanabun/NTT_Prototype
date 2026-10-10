# Basketly — Hybrid Smart-Basket Prototype

A two-basket, two-lane retail demo. A shelf event updates a shopper cart only when the deterministic policy can identify an active basket with clear evidence. Ambiguous or missing evidence stays pending and requires customer or staff confirmation. The amount shown at checkout includes confirmed items only.

The [primary IoT roadmap](docs/iot-roadmap.md) sets the hardware delivery order: ESP32 and two switches into the local app first, three DX-CP101 beacons second, and AWS IoT Core third. Follow that roadmap for IoT implementation; the cloud architecture below remains the longer-term target.

## Run locally

Requirements: Node.js 20 or newer. No package install or cloud account is needed.

    npm start

Open http://127.0.0.1:3000. The web app and API are served by the same Node process; EventSource streams state changes to both views. Demo state and case audit are persisted to the ignored data/demo-state.json file. Use the reset button to clear the local demo.

1. In Shopper app, choose Basket A and select Start shopping. A URL with ?basket=A can also start a session, which is the payload expected on a basket QR.
2. Open Staff dashboard and use the simulator controls. Select Coke or Water to choose a shelf lane.
3. Try Clear pick, then Ambiguous pick. Return to Shopper app and confirm YES or choose NO to route it to staff.
4. Try Low agent confidence or Unknown zone and resolve the case from Staff dashboard.
5. Send a confirmed pick followed by Put back. Send Duplicate delivery to verify the same event ID is ignored.
6. Mock checkout is enabled only for an active session with confirmed lines and no unresolved case affecting that basket. No payment is processed.

The QR camera uses the browser BarcodeDetector API where available and accepts a QR containing a URL parameter basket=A or basket=B. The two basket buttons are the manual fallback for browsers without native QR scanning.

## Safety policy

- A clear RSSI lead of at least 10 dB selects the nearest basket and bypasses the Agent. This is an initial demo threshold; calibrate it on the physical shelf.
- RSSI inside that margin is ambiguous. The local case-manager mock records its evidence and tool calls; a customer must confirm before the item reaches the cart.
- Missing RSSI, tied evidence, a missing session, or a cart conflict routes to staff review.
- No pending case contributes to a payable total. An unresolved case with no basket candidate blocks both baskets until staff closes it.
- Duplicate event IDs are idempotent. PUT_BACK never makes a cart quantity negative.
- BLE is treated as proximity evidence, not proof of who picked up an item.

## Prototype architecture

The local harness gives the team a testable vertical slice while AWS credentials and the parts are being prepared:

    Browser PWA ── HTTP API + Server-Sent Events ── Node domain/FSM ── in-memory store
                                                       ↑
                                               event simulator

The intended cloud path remains AWS-native:

    ESP32 ── MQTT/TLS ── AWS IoT Core ── Lambda ── DynamoDB
                                                      ├── API Gateway HTTP / WebSocket
                                                      └── Step Functions ── Bedrock case manager

| Area | Prototype source in this repository | AWS target from the plan |
| --- | --- | --- |
| Shopper and staff UI | Installable-style PWA shell, native browser APIs, responsive CSS | Next.js App Router, TypeScript, TailwindCSS, shadcn/ui |
| Local event/API runtime | Node.js standard library, Server-Sent Events | API Gateway, Lambda, AppSync or API Gateway WebSocket |
| Transaction policy | Deterministic FSM in src/domain.mjs | Lambda + Step Functions Standard |
| Ambiguous-case simulation | Local evidence/recommendation mock; no external model call | Amazon Bedrock Agent and Lambda tools |
| State | Local JSON store (ignored by Git) | DynamoDB |
| Shelf device | ESP32 Arduino firmware draft | AWS IoT Core MQTT/TLS |
| Staff login | Omitted for localhost demo | Cognito |
| Payment | Mock order only | No real payment in prototype |

The local path is executable without downloading dependencies. It is not an AWS deployment and does not call Bedrock. The firmware has not been compiled or flashed, and no IoT certificates are included. See firmware/README.md before connecting hardware.

The requested Next.js dependency set was not present in this empty workspace, and the npm registry did not respond from this environment. To keep the prototype runnable here, the local harness uses the Node.js standard library; the table above keeps the planned Next.js/AWS target explicit.

## Source layout

- src/domain.mjs — event validation, idempotency, cart FSM, case policy, HITL decisions and mock checkout.
- src/server.mjs — localhost HTTP API, static PWA host and realtime event stream.
- public/ — shopper and staff views, PWA manifest, native camera scanning and event simulator.
- firmware/esp32/smart_shelf.ino — ESP32 switch debounce, BLE RSSI median and MQTT event publisher.
- tests/domain.test.mjs — acceptance checks for clear/duplicate, ambiguous, low-confidence, missing-RSSI and PUT_BACK flows.
- docs/event-contract.md — shared device/API event contract and deterministic decision table.

## Delivery phases

| Phase | State in this implementation |
| --- | --- |
| 1 · Software first | Local simulator, event API, cart, shopper view, staff monitor and live updates implemented. IoT Core/DynamoDB deployment remains to be wired after AWS credentials are available. |
| 2 · Agentic flow | Customer confirmation, staff review, audit timeline and validator behavior implemented locally. A real Bedrock Agent, Lambda tools and Step Functions deployment remain unconfigured; local suggestions are labeled as simulation. |
| 3 · Hardware | ESP32 firmware draft covers two lane sensors, debounce, five-sample RSSI median, Wi-Fi and MQTT/TLS. Physical wiring and end-to-end demonstration remain to be done with the ordered devices. |
| 4 · Audit and stability | Local case timeline and software acceptance tests are included. The 20–30 physical cycles, AWS retention/budget controls and CloudTrail checks remain hardware/cloud work. |
| 5 · Demo freeze | Rehearse the three journeys in this PWA. Cloud deployment, physical failure rehearsal and backup video are not performed from this workspace. |

## Check the software acceptance rules

    npm test

The tests use Node's built-in test runner. For physical acceptance, repeat PICK/PUT_BACK for Coke and Water, inject sensor bounce and duplicate MQTT deliveries, move both tags near one another, remove one tag, then verify that no unresolved line is chargeable and event-to-screen latency stays under 1.5 seconds.

## Next cloud implementation checkpoint

Provision a development AWS account and region, create an IoT thing/certificate and least-privilege topic policy, then add the deployable SAM/CDK stack for DynamoDB, IoT Rules, Lambda, HTTP/WebSocket APIs and the Step Functions HITL callbacks. Configure a Bedrock Agent only after those deterministic paths work; deploy budget alarms and short log retention before running scenarios against cloud resources.
