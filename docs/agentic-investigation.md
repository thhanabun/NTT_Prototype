# Model-directed evidence investigation

## Current behavior

The HTTP server defaults to `AGENT_PROVIDER=laya`, `AGENT_MODE=agentic`. Each ambiguous case runs **select → execute → observe → select again**. Real local Laya chooses one typed action from the currently available tools/scripts using the observations returned so far. There is no fixed tool order in this mode and no silent mock-planner fallback.

`DECIDE` becomes available after the three core tools have been read, in any order. It calls the basket-choice model, then deterministic policy and human confirmation. `STOP_STAFF` lets the model stop gathering evidence without inventing missing data. Unavailable/repeated actions, malformed responses, transport errors, an eight-action limit and a 25-second investigation deadline all keep the case for staff.

Laya is a typed decision model. It does not generate a reasoning narrative or arbitrary scripts. The trace records model-selected actions, probabilities and observations; it does not fabricate hidden chain of thought. Selection quality on retail evidence still requires evaluation.

The shared application factory accepts `agentPlanner` for dependency injection; HTTP and Lambda provide the real Laya selector by default. `AGENT_MODE=workflow` retains the previous fixed-tool comparison path. MOCK and optional Jev retain their previous workflow behavior. Existing model/full-flow regression scripts explicitly use workflow mode because they assert its one-inference/three-tool contract. Use the new Agentic system check for adaptive behavior.

## Tools and scripts

All tools are read-only. Local tool arguments are bound to the current case's event; the model cannot supply another event ID, shell command, executable or file path.

| Tool | Evidence |
| --- | --- |
| `get_shelf_event` | Source event, lane, SKU, action and delayed flag |
| `get_basket_evidence` | RSSI, margin, nearest basket and active-session flags |
| `get_cart_history` | Confirmed quantities, sessions, recent orders and resolutions |
| `get_signal_window` | Up to 12 telemetry samples within ±3 seconds of event receipt |
| `get_device_health` | Sample age, uptime decrease, queue backlog and new dropped events near the event |
| `get_lane_state` | Independently reported switch presence near the event; missing data remains UNKNOWN |
| `get_event_neighbors` | Up to 12 nearby same-lane events, with receipt-time provenance |
| `get_camera_evidence` | Camera observation records linked to the event, including source and alignment |
| `run_evidence_analysis` | Run one allowlisted read-only analysis script |

Scripts selectable after reading their supporting evidence:

- `rssi_stability`: sample coverage, median/range and nearest-basket changes.
- `switch_bounce`: nearby lane events and contradictory reported switch presence. Receipt-time bursts can also be transport effects; this warns staff rather than proving physical bounce.
- `cart_consistency`: sessions and confirmed quantities eligible for PICK/PUT_BACK.

Explicit conflicts from collected analysis, degraded-device evidence or aligned CAMERA observations block customer-confirmation routing even if the model is confident. Extra evidence never overrides the RSSI/session/quantity guards. Cart writes still require the existing human decision and backend validation.

## Collectors

- `POST /api/telemetry`: accepts local firmware (`uptimeMs`, `rssi`, `lanes`) and AWS firmware (`uptime`, `baskets`) formats. Broker and IoT bridge forward exact telemetry topics. The bridge IAM template now includes telemetry subscribe/receive permissions. Telemetry is not acknowledged as a shelf event.
- Retains 120 telemetry samples. Without a source timestamp, provenance is `SERVER_RECEIPT`; delayed signals do not acquire invented capture-time evidence.
- `POST /api/evidence/camera`: requires an existing `eventId`, `cameraId`, `source` (`CAMERA` or `MOCK`), optional `capturedAt`, and observations from `PICK_VISIBLE`, `PUT_BACK_VISIBLE`, `OCCLUDED`, `INCONCLUSIVE`. Retains 20 records.
- **Camera support is an observation adapter. No RTSP capture, ring buffer or image inference is implemented.** No records means `NO_DATA`. A source label on the unauthenticated local API is not proof of an authenticated camera producer.
- Evidence and traces use the existing repository. The DynamoDB aggregate still has a 400 KB item limit; richer results make normalization/pruning necessary before scale. Shelf monitor status remains backend-reported; the health tool is not a continuously updating offline dashboard.

## Inspect and try

Admin case details show **Agentic investigation**: action selected by the model, selection probability, available actions, and the resulting observation. Expand tool entries to read inputs/results. Each selection and tool completion is in the case timeline/audit. Human actions remain blocked while Agent is RUNNING.

Start/restart API and broker on this branch, keep Laya running, and start Shopper A/B sessions:

```powershell
$env:AGENT_PROVIDER='laya'
$env:AGENT_MODE='agentic'
npm start
```

In another terminal at the repository root, run one scenario at a time and resolve its open cases:

```powershell
npm run mock:evidence -- stable
npm run mock:evidence -- unstable
npm run mock:evidence -- bounce
npm run mock:evidence -- camera
npm run mock:evidence -- missing
```

These publish real local MQTT events/telemetry and wait for an application ACK. Camera supplies explicitly MOCK occlusion metadata. Missing tags demonstrate deterministic staff routing without model inference. Each invocation simulates a device lifecycle. Selecting every tool is not a requirement; the model may stop for staff or exhaust its budget.

## Verification and cloud boundary

`npm test` includes deterministic planner fixtures for different tool orders, script selection/conflict veto, missing evidence, invalid actions, deadlines, budget and read-only carts. Fixture choices are not claims about model accuracy. `npm run test:system:agentic` in `web/` uses actual Laya, MQTT telemetry, native SSE and Chromium, retaining reports/screenshots under `data/web-system-*/`. Stop the other Next.js dev server in this checkout first. The original `test:system` remains workflow regression coverage.

Bedrock schema/instructions include the new tools/scripts. `get_basket_decision` remains the read-only Laya decision adapter for an outer Bedrock orchestrator. Local runtime uses the Laya selector directly. Live AWS deployment, trusted collectors, API authorization and Step Functions callbacks remain separate work.

## Verification on 22 October 2026

- `npm test`: 40/40 passed, including seven new evidence/Agentic checks. Planner fixtures demonstrate multiple tool orders, selected analysis, conflict veto, stopping, deadlines and the step budget.
- Web lint, typecheck and production build passed. All four existing auth/Shopper/Admin/native-SSE browser suites passed after the trace UI change.
- Actual Laya + Chromium + MQTT system checks passed twice. Latest report: `data/web-system-1792652900313/report.json`; earlier successful report: `data/web-system-1792652738407/report.json`. Each run completed 30 PICK/duplicate/PUT_BACK cycles, 99 event deliveries, 12 telemetry messages, three real model-directed investigations, Staff decisions, checkout, persistence and audit.
- In those three actual-model scenarios, Laya selected `get_shelf_event → get_cart_history → get_basket_evidence → analyze_cart_consistency → DECIDE`. This was selected by the model, not imposed by the loop; all three happened to take the same path. Confidence remained below customer-confirmation policy and all required Staff. Other tools/scripts were verified with deterministic fixtures; their selection by the real model is not claimed.
- A first browser attempt stopped because the team's dev server held the Next.js checkout lock. It was not counted as a pass. The dev server was temporarily stopped for the isolated checks and restored on port 3001 afterward. No team demo database was reset.
