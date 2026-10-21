# Web App Plan

Status: frontend scope and current local API documented; teammate agreement on the cloud contract is pending.

This plan covers the Shopper App and Admin Dashboard. It is based on `src/server.mjs`, `src/domain.mjs`, `public/`, and `docs/event-contract.md`. Current behavior and proposed frontend behavior are identified separately. Acceptance checkboxes below are future verification tasks, not claims that the new web app has been implemented.

## 1. Scope and ownership

| Area | Responsibility |
| --- | --- |
| Shopper App | Basket pairing, session display, cart, customer confirmation, mock checkout, receipt |
| Admin Dashboard | Operational overview, basket summaries, case review, staff decisions, activity |
| Frontend integration | API requests, live updates, frontend error handling, integration verification |
| Hardware and firmware | Sensors, ESP32, BLE tags, device events, MQTT |
| Backend and Agent | Cart policy, validation, persistence, case routing, AI recommendations, cloud endpoints |
| AWS infrastructure | Provisioning, access policies, backend deployment, cost controls |
| Frontend hosting | Agree on hosting, build/deploy the web app, verify HTTPS and permitted region |

### First-version boundaries

- One shelf: `SHELF-01`.
- Two baskets: `A` and `B`.
- Two lanes: `LANE-1` for `COKE`; `LANE-2` for `WATER`.
- Coca-Cola costs THB 25; Mineral water costs THB 15. Display prices from the API rather than duplicating them in frontend logic.
- Pair a basket using a QR URL containing `?basket=A` or `?basket=B`, with manual A/B selection as a fallback. No NFC integration in the first version.
- Shelf events and confirmed decisions change cart quantities. No manual quantity editing or delete-item controls.
- Checkout creates a mock order. No real payment.
- Admin means store operations and case review. Product CRUD, promotions, profiles, user management, and sales analytics are outside the first version.
- RSSI shows proximity evidence, not an exact position, GPS coordinates, or an inferred store map.
- Tag identifiers such as `TAG-A01` are not exposed by the current API. Do not present them as live backend data.
- Current recommendations and tool-call records are a local simulation. Label them accordingly until a real cloud Agent is connected.

### Development boundary

Phases 1–6 use sample data or the existing local Node backend. No AWS deployment, cloud model invocation, or cloud credentials are required for these phases. Other resources teammates have already provisioned can incur charges independently.

The existing frontend is vanilla HTML/CSS/JavaScript in `public/`. The planned new frontend is a separate Next.js App Router project in `web/`, with TypeScript, Tailwind CSS, and shared UI components. This plan does not create that project.

## 2. Screens and UI states

Proposed routes are `/shopper` and `/admin`. They do not exist in the current static server. Shopper sections can remain on one mobile-friendly page; Admin case detail can be a panel or dialog rather than requiring another route.

### Shopper App

| Section | Required content/actions | Data source |
| --- | --- | --- |
| Connect basket | QR scanner, manual A/B selection, Start shopping | QR/manual input; `POST /api/sessions` |
| Session | Basket ID, active/inactive status, session start time | Selected basket's `session` |
| Cart | Confirmed lines, quantity, price, subtotal, total | Selected basket's `lines` and `total`; `products` |
| Customer confirmation | Product, PICK or PUT_BACK wording, YES/NO actions | `WAITING_CUSTOMER` cases matching the selected basket |
| Staff review | Explain pending review and checkout blocking | Relevant `OPEN_STAFF` cases; `unresolvedCaseCount` |
| Mock checkout | Enabled/disabled state and reason | Active session, nonempty lines, backend `payable` |
| Receipt | Order ID, confirmed lines, total, mock-payment label | Checkout response; basket's recent order when appropriate |

Required states:

- [ ] Initial loading and failed-load retry.
- [ ] Basket not paired / session not started.
- [ ] Active session with an empty cart.
- [ ] Confirmed cart items.
- [ ] Waiting for customer confirmation, including an uncertain PUT_BACK.
- [ ] Multiple waiting cases, handled one at a time without losing the remaining cases.
- [ ] Waiting for staff, including a case with no basket candidate.
- [ ] Checkout disabled because the session is missing, cart is empty, or a relevant case is unresolved.
- [ ] Action in progress; disable duplicate submissions until the response is received.
- [ ] Action rejected by backend; preserve server-confirmed state and explain the error.
- [ ] Camera permission denied or QR detection unavailable; manual selection remains usable.
- [ ] Live connection lost and recovered.
- [ ] Mock checkout completed; cart cleared, session closed, receipt visible.

### Admin Dashboard

| Section | Required content/actions | Data source |
| --- | --- | --- |
| Overview | Shelf status, last seen, latest event, workflow state, open cases | `shelf`, `recentEvents`, `cases` |
| Basket summaries | A/B session status, confirmed items, total, pending count | `baskets` |
| Proximity evidence | RSSI A/B, missing-reading state, last event time | `shelf.rssi`, `shelf.lastSeenAt` |
| Case list | Type, product, status, candidate, timestamp; open/closed filter | `cases`, `products` |
| Case details | Event type, reason, evidence, confidence, proposed action, tool records, timeline | Selected case |
| Staff decision | Explicit A/B choice, Approve, Reject | Staff case endpoint |
| Recent activity | Recent events and resolutions | `recentEvents`; case timeline/resolution |

Required states:

- [ ] Loading, load error, and retry.
- [ ] No events, no RSSI, idle baskets, and no open cases.
- [ ] `WAITING_CUSTOMER`: show pending customer action; proposed UI does not expose staff decision controls here.
- [ ] `OPEN_STAFF`: allow explicit basket selection and approve/reject.
- [ ] Candidate is `null`: require a basket choice before approval.
- [ ] `CLOSED`: display the resolution and disable decision controls.
- [ ] Approval rejected because the target has no active session or a PUT_BACK has no matching quantity.
- [ ] Case already closed by another viewer; refresh server state and explain the result.
- [ ] Live connection lost; show stale/last-updated information rather than claiming everything is live.

Current limitations: `shelf.status` is initialized to `ONLINE`; there is no device health/offline timeout in the backend. `lastSeenAt` is an event timestamp, not a separate health heartbeat. The case snapshot is limited to 30 cases, so case counts derived from it are counts of loaded cases, not guaranteed global totals. Cloud health and aggregate counts need teammate agreement.

## 3. Current local API contract

Base address: `http://127.0.0.1:3000` by default. Start the existing backend with `npm start` from the repository root. Mutating requests send JSON with `Content-Type: application/json`.

The new frontend will run separately, so Phase 2 must configure a same-origin development proxy, including the SSE route, or agree on backend CORS support. The current backend has no CORS configuration or authentication. Its all-basket state endpoint is suitable for the local demo; cloud access must be scoped and authorized by the backend.

| Method | Path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/state` | None | `200`: full snapshot described below |
| GET | `/api/stream` | None | `200`: SSE connection with named `state` events containing the same snapshot |
| POST | `/api/sessions` | `{ "basketId": "A" }` | `201`: `{ "session": Session }`; reuses an existing active session |
| POST | `/api/cases/:caseId/customer` | `{ "answer": "YES" }` or `{ "answer": "NO" }` | `200`: `{ "case": Case }` |
| POST | `/api/cases/:caseId/staff` | `{ "decision": "APPROVE", "basketId": "B" }` or `{ "decision": "REJECT" }` | `200`: `{ "case": Case }` |
| POST | `/api/checkout` | `{ "basketId": "A" }` | `200`: `{ "order": Order }` |
| POST | `/api/events` | Shelf event; see example below | `200`: duplicate or processed-event result |
| POST | `/api/reset` | `{}` | `200`: `{ "ok": true }` |

`/api/events` and `/api/reset` are local demo/test facilities. Use the existing simulator for development; building a replacement simulator is optional. Any reset UI must ask for confirmation. Cloud availability and authorization of these endpoints are undecided.

### Snapshot and shared objects

| Object | Fields available now |
| --- | --- |
| Snapshot | `products`, `shelf`, `baskets`, `cases`, `recentEvents`, `recentOrders`, `policy` |
| Product | `sku`, `name`, `price`, `color` |
| Shelf | `shelfId`, `status`, `lastSeenAt`, `fsmState`, `rssi: { A, B }`, `lastEventId` |
| Basket | `basketId`, `session` or `null`, `lines`, `total`, `payable`, `unresolvedCaseCount` |
| Session | `sessionId`, `basketId`, `status`, `startedAt`; closed sessions can also have `closedAt` |
| Cart line | `sku`, `name`, `price`, `quantity`, `subtotal` |
| Case | `caseId`, `eventId`, `type`, `eventType`, `sku`, `status`, `candidate`, `confidence`, `nextAction`, `proposedAction`, `evidence`, `toolCalls`, `reason`, `createdAt`, `updatedAt`, `timeline`; `resolution` after closure |
| Evidence | `rssi`, `zone`; optional `marginDb`, `session`, or `cartQuantity` depending on case type |
| Timeline entry | `at`, `action`, and action-specific details such as `basketId`, `nextAction`, or `reason` |
| Resolution | `actor` (`CUSTOMER`/`STAFF`), `decision`, optional `basketId` |
| Event | `eventId`, `shelfId`, `laneId`, `sku`, `eventType`, `timestamp`, `receivedAt`, `rssi` |
| Order | `orderId`, `basketId`, `lines`, `total`, `createdAt`, `paymentMode: "MOCK"` |
| Order line | `sku`, `name`, `quantity`, `unitPrice`, `subtotal` |
| Policy | `clearMarginDb`, `customerConfirmThreshold` |

Important differences: cart lines use `price`; order lines use `unitPrice`. Confidence is a number from 0 to 1, displayed as a percentage. Missing RSSI and missing candidates are `null`. Recent events are limited to 20 and recent orders to 10; these are not complete history APIs.

### Case lifecycle and rules

| Status | Meaning | Frontend action |
| --- | --- | --- |
| `WAITING_CUSTOMER` | A candidate basket needs customer confirmation | Show YES/NO to the matching shopper |
| `OPEN_STAFF` | Staff decision is needed | Show basket selection, Approve, Reject in Admin |
| `CLOSED` | Customer or staff resolved the case | Display resolution and timeline |

Case types currently include `AMBIGUOUS_PICK`, `AMBIGUOUS_PUT_BACK`, `ZONE_UNKNOWN`, `MISSING_SESSION`, and `CONFLICT`. Next actions are `CUSTOMER_CONFIRM`, `STAFF_HITL`, or `CLOSE`.

- Customer YES attempts the cart mutation; validation failure moves the case to `OPEN_STAFF`, so a successful HTTP response does not always mean the case closed.
- Customer NO moves the case to `OPEN_STAFF` without changing the cart.
- Staff approval validates the target session and cart before closing. Rejection closes without changing the cart.
- The current staff endpoint also accepts a waiting-customer case. Restricting staff actions to `OPEN_STAFF` is proposed UI behavior, not a backend authorization guarantee; agree on override policy with the teammate.
- Open cases with no candidate block both baskets. Otherwise an open case blocks its candidate basket; `ZONE_UNKNOWN` also blocks both.
- `payable` alone does not mean checkout can proceed: the frontend also requires an active session and nonempty cart. The server validates again.
- Pending items never contribute to totals. Display backend totals rather than applying RSSI policy in the browser.
- UI guards cannot replace backend authorization or concurrency protection.

### Local shelf-event example

```json
{
  "eventId": "demo-001",
  "shelfId": "SHELF-01",
  "laneId": "LANE-1",
  "eventType": "PICK",
  "rssi": { "A": -48, "B": -73 }
}
```

`eventId`, `laneId`, and `eventType` are required. `sku` is derived from the lane; if provided it must match. `shelfId` and `timestamp` have defaults. Finite RSSI readings must be between -127 and 0; missing or nonnumeric readings become `null` and route to staff. Use a fresh event ID for each new event; repeat the same ID only to test duplicate delivery. See [event-contract.md](event-contract.md).

Processed events return `{ duplicate: false, event, disposition, ... }`, where disposition is `CONFIRMED`, `PENDING`, or `CONFLICT`, with `basketId` or `caseId` as appropriate. Duplicates return `{ duplicate: true, eventId }` and do not publish a state change.

### Errors and live updates

- API errors use `{ "error": "message" }`. Current server mappings are `400` for malformed JSON, `409` for thrown domain/validation errors, and `404` for unknown API routes. Do not assume these are the final cloud status codes.
- SSE sends an initial snapshot and a fresh snapshot after successful state mutations. Listen to the named `state` event, not just the default message event.
- Stream retry is 1,500 ms; comment heartbeats are every 15 seconds. Heartbeats indicate stream activity, not shelf health.
- Maintain one stream per mounted app and close it on cleanup. Avoid adding repeated polling while a stream is healthy.
- Disable action buttons while requests are pending. On an uncertain network outcome, refresh authoritative state before retrying a mutation. General mutation idempotency is not implemented; only shelf-event IDs have explicit deduplication.
- Never show a cart update as confirmed solely because a button was pressed.

## 4. Acceptance checklist for the new web app

Run these locally using the existing simulator. Reset between independent scenarios and start the required basket sessions. These checks are scheduled for later phases.

| Check | Setup/action | Expected result |
| --- | --- | --- |
| [ ] Pairing | Open a QR URL for A/B; also test manual selection and denied camera permission | Correct basket selected; session starts; manual fallback works |
| [ ] Clear pick | Active A; PICK Coke with A=-48, B=-73 | A has one Coke, total THB 25; no case |
| [ ] Basket B and Water | Active B; PICK Water with A=-73, B=-48 | B has one Water, total THB 15 |
| [ ] Duplicate delivery | Send the exact clear-pick event ID again | Quantity and total stay unchanged |
| [ ] Customer YES | Active A; PICK with A=-55, B=-57; answer YES | Item stays out of cart while pending, then enters A after confirmation |
| [ ] Customer NO | Repeat ambiguous PICK with a new ID; answer NO | Case moves to staff; no cart mutation |
| [ ] Staff assignment | Active A/B; tied PICK with A=-56, B=-56; approve to B | No candidate initially; pending case blocks both; item assigned to B after approval |
| [ ] Unknown zone | PICK with missing RSSI; staff rejects | No payable cart changes; case closes |
| [ ] Missing session | Clear PICK nearest an inactive basket | Staff case appears; no automatic cart addition |
| [ ] Put-back | Clear PICK followed by clear PUT_BACK with different IDs | Confirmed quantity decreases; no negative quantity |
| [ ] Invalid put-back | PUT_BACK with no confirmed item | Conflict case; no cart mutation |
| [ ] Ambiguous put-back | Add Coke to A, then ambiguous PUT_BACK; confirm YES | Prompt says return/remove, not add; item removed only after validation |
| [ ] Checkout blocked | Have confirmed items plus an unresolved relevant case | Button disabled with reason; backend also rejects checkout |
| [ ] Checkout success | Active session, nonempty confirmed cart, no relevant unresolved cases | Receipt shown; session closes and cart clears; no real payment |
| [ ] Live updates | Keep Shopper and Admin open; send events/decisions | Both reflect the same server state without manual refresh |
| [ ] Failure/recovery | Stop/restart the local backend; try a rejected or already-closed case action | Clear error/stale state; recovery refreshes authoritative data |
| [ ] Responsive/accessibility | Phone and desktop widths; keyboard interaction | No horizontal overflow; controls have labels and visible focus; states do not rely only on color |

## 5. Cloud handoff and cost boundaries

Phase 7 connects the frontend to the team's cloud API; Phase 8 hosts the frontend. Backend provisioning and Agent implementation belong to teammates. Preserve the local JSON contract where possible, or adapt it in a shared frontend API layer.

- Keep local and cloud API addresses configurable. Do not put AWS credentials or SSO credentials in browser code.
- Read state and case results when opening or refreshing a screen. Do not make screen rendering trigger model analysis.
- Use one coordinated live-update channel and bounded reconnect behavior. Avoid uncontrolled polling/retry loops.
- Show cached Agent results supplied by the backend. Backend owns analysis deduplication, token/output limits, model-call limits, and usage tracking.
- Before cloud testing, agree on the model, permitted region, request volume, and a test budget. Token counts/prices and infrastructure charges must be calculated by the cloud/Agent owner using the chosen services.
- Competition slides supplied by the user specify a USD 350 team budget and allow `us-east-1`, `ap-southeast-1`, and `ap-southeast-7`. Confirm service/model availability and sandbox permissions before deployment; these slides do not establish all scoring requirements.

### Questions for teammates

| Question | Needed by | Status |
| --- | --- | --- |
| Can cloud endpoints preserve the local request/response shapes and case statuses? | Before cloud adapter work | Pending teammate review |
| What are the cloud API base URL, route prefix, and error format? | Phase 7 | Pending |
| How are shopper sessions scoped, and how does staff authenticate? How are all-basket data and staff mutations protected? | Before any shared cloud demo | Pending |
| Will cloud realtime use SSE, WebSocket, or another transport? What payload, auth, reconnect, and subscription rules apply? | Before Phase 7 realtime integration | Pending |
| Which frontend origins are allowed, and is a proxy needed? | Phase 7 | Pending |
| Can staff override a waiting-customer case? How are concurrent decisions and mutation retries handled? | UI policy review / Phase 7 | Pending |
| Will the backend expose actual shelf health, global counts, tag IDs, and session-scoped history? | Before displaying those as live facts | Pending; first version uses existing fields only |
| Are simulator/reset endpoints available and restricted in cloud? | Before cloud test controls are enabled | Pending |
| Which allowed region and frontend hosting service can the team account use? | Before deployment | Pending |
| What is the cloud test budget, and who monitors usage/model-call limits? | Before first cloud test | Pending |

## 6. Kanban phases and completion

| Phase | Issue title |
| --- | --- |
| 1 | Define Web App Scope and API Contract |
| 2 | Set Up the Frontend Project |
| 3 | Build the Shopper App UI |
| 4 | Connect the Shopper App to the Local API |
| 5 | Build and Connect the Admin Dashboard |
| 6 | Add Local Live Updates and Verify Demo Journeys |
| 7 | Connect the Web App to the AWS Backend |
| 8 | Deploy the Web App to AWS and Prepare the Demo |

Use Backlog → Ready → In Progress → Review/Test → Done. Cloud integration and deployment depend on teammate readiness.

Phase 1 deliverables:

- [x] Document first-version scope and ownership.
- [x] Document required screens and states.
- [x] Map current local API requests, responses, errors, and live updates.
- [x] Define acceptance checks and cloud cost boundaries.
- [x] Record questions requiring teammate agreement.
- [ ] Review and agree on scope/API assumptions with the backend teammate.

The documentation work for Phase 1 is complete. Team agreement remains pending. Phase 2 can proceed against the existing local contract while cloud-specific questions remain open.

### Phase 3 implementation checkpoint

The `/shopper` route now provides a responsive UI preview with local sample data. Completed UI work:

- [x] Manual Basket A/B selection and session display.
- [x] QR entry-point preview with an explanation and manual fallback; real camera integration remains Phase 4.
- [x] Product display and confirmed cart with Coke THB 25 and Water THB 15.
- [x] Empty, loading, submitting, load-error, action-error, and disconnected states.
- [x] Separate confirmation wording for PICK and PUT_BACK, including multiple pending cases.
- [x] Staff-review messaging and checkout-blocking reasons.
- [x] Mock receipt using the displayed confirmed sample lines.
- [x] Preview controls to inspect each screen state without backend/model requests.
- [x] Browser interaction checks at 320, 390, 768, and 1440 pixel widths with no horizontal overflow, API requests, or console errors.

Fixtures and rendering live in `web/src/components/shopper/`. This checkpoint covers the UI only; the earlier end-to-end acceptance checklist remains pending for real API integration. API mutations/QR scanning belong to Phase 4, live updates to Phase 6, and cloud integration to Phase 7.

### Phase 4 implementation checkpoint

`/shopper` now reads the local API; the Phase 3 fixture screen remains at `/shopper/preview`.

- [x] Start/reuse basket sessions and persist the selected A/B basket in the URL and optional local storage.
- [x] Display API products, confirmed lines, prices, quantities, totals, and session timestamps.
- [x] Refresh the snapshot manually and after mutations, with loading, stale-data, and error states.
- [x] Submit customer YES/NO and display the server's resulting case/cart state, including staff escalation and multiple waiting cases.
- [x] Block checkout for pending cases, missing sessions/items, pending submissions, or unavailable current data.
- [x] Submit mock checkout and display the backend order; preserve the receipt if the following snapshot read fails.
- [x] Prevent concurrent UI submissions and reload state before allowing retry after uncertain mutation responses.
- [x] Scan QR URLs when supported, retain manual fallback, and release camera tracks on close/success.
- [x] Verify the workflow against an isolated instance of the real local backend with browser integration checks, including failure recovery.

The browser checks simulate camera APIs. Real-phone QR/camera verification remains a manual device check. Automatic live updates and Admin workflows are still future phases; Phase 4 uses explicit refresh, never periodic polling. Authentication and AWS integration remain Phase 7 dependencies.

Next phases:

| Phase | What changes next |
| --- | --- |
| 5 | Build Admin overview, basket monitoring, case evidence/timeline, and staff decision UI against the local API |
| 6 | Add coordinated realtime updates, reconnect/stale-state handling, and test Shopper/Admin journeys together |
| 7 | Integrate the agreed AWS API, authentication, and cloud realtime within a bounded test budget |
| 8 | Deploy the web app to permitted AWS hosting and rehearse the HTTPS demo on devices |

### Phase 5 implementation checkpoint

`/admin` now provides the store operations dashboard against the same local API as Shopper.

- [x] Display reported shelf/workflow status, active baskets, confirmed carts, and loaded-case counts.
- [x] Display RSSI evidence without claiming exact tracking or live hardware health.
- [x] Filter open/staff/customer/closed cases and inspect reasons, candidate, proposed action, confidence, tool records, and timeline.
- [x] Approve to an explicit basket or reject staff cases; keep waiting-customer and closed cases read-only.
- [x] Block invalid approval targets and concurrent UI submissions; let backend validation remain authoritative.
- [x] Refresh after decisions and preserve last confirmed state during failed reads or uncertain mutation responses.
- [x] Provide development-only simulator controls for Coke/Water lanes, clear A/B picks, ambiguity, tied/missing RSSI, put-back, and duplicate delivery.
- [x] Verify staff decisions, simulator events, stale/concurrent-case recovery, shared Shopper data, and responsive layouts against an isolated local backend.

There is no polling, EventSource subscription, real Agent call, AWS deployment, or staff authentication in Phase 5. Phase 6 will coordinate automatic updates and reconnection. Per the agreed stopping point, complete Phase 6 locally and then wait for the cloud/backend team before Phase 7.

### Phase 6 implementation checkpoint

Shopper and Admin now subscribe to the existing local SSE endpoint through one shared store per browser tab.

- [x] Update carts, sessions, customer/staff cases, dashboard metrics, and receipts automatically from named `state` snapshots.
- [x] Share one EventSource per tab and release it on client navigation away from subscribed screens, including Strict Mode cleanup.
- [x] Display connecting/live/reconnecting/offline/manual-fallback status and preserve the last snapshot on failures.
- [x] Block mutations while data is stale and recover from a full snapshot without replaying user actions.
- [x] Use five capped retries (1.5, 3, 6, 12, 30 seconds), then require explicit retry; no periodic polling.
- [x] Prevent delayed HTTP reads from overwriting newer stream snapshots and abort pending reads on cleanup.
- [x] Preserve fixture preview isolation and the manual fallback when EventSource is unavailable.
- [x] Verify native SSE across Shopper A/B/Admin tabs, backend restart, stale-data guards, retry exhaustion, no duplicate streams/actions, client navigation cleanup, and responsive connection states.

No backend business rules or AWS resources were changed. Native realtime tests use isolated local persistence and test-only diagnostics in a temporary server copy. Real-phone QR verification remains a separate manual check.

Agreed stopping point: Phases 1–6 are implemented locally. Phase 7A may prepare mock Admin login locally. Wait for the backend/cloud team's API, authentication, realtime transport, region, permissions, and test-budget agreement before Phase 7B/7C cloud integration. Phase 8 hosting remains later work.

### Phase 7 implementation scope

| Part | Issue title | Dependency |
| --- | --- | --- |
| 7A | Build the Admin Login UI with a Local Mock Session | Local frontend only |
| 7B | Integrate Real Authentication and the AWS API | Agreed backend identity, roles, API contract, region, permissions, test budget |
| 7C | Integrate Authorized Cloud Realtime | Agreed transport, scoped payloads, subscription auth and retry policy |

Phase 7A adds `/admin/login`, a fictional publicly documented staff test account, field validation, password visibility, submitting/invalid-credential/storage-error states, a 30-minute tab-local mock session, logout, and expiry simulation. Gate `/admin` before mounting its dashboard or subscribing to local state; leave Shopper guest-accessible. Require an explicit development flag and disable mock Admin access in production regardless of that flag. Never save passwords or call an identity provider/model from the mock flow.

This gate is a UI simulation, not backend authentication or authorization. The existing local API and old demo stay unauthenticated. No public staff registration, real accounts, password recovery, cloud deployment, IAM/AWS credentials, or Agent changes are included. Real staff roles and shopper-owned data enforcement must be implemented with the backend team in Phase 7B. Login alone does not authorize API requests or realtime subscriptions.

Phase 7A verification covers direct entry before login with no state/SSE requests, form validation and keyboard use, login and refresh persistence, logout/back navigation, automatic and simulated expiry, malformed/unavailable storage, independent-tab behavior, live subscription cleanup, guest Shopper, responsive layouts, and unavailable Admin in normal-dev/production mode. Existing Shopper/Admin/realtime journeys must continue to pass. The Phase 7A pull request is reviewed and merged by the user.
