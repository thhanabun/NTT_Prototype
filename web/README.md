# Basketly Web

The separate Next.js frontend for the Basketly prototype. The root Node server remains the source of truth for basket state and serves the local API.

## Run locally

Use Node.js 20.18.1 or newer. In one terminal, start the backend from the repository root:

```sh
npm start
```

In another terminal, start the frontend from this directory:

```sh
npm install
npm run dev
```

The frontend runs at <http://127.0.0.1:3001>. In development, it forwards same-origin `/api/*` requests, including the `/api/stream` Server-Sent Events connection, to `http://127.0.0.1:3000`.

Set `LOCAL_API_ORIGIN` in `.env.local` to change the backend origin. The default is `http://127.0.0.1:3000`; `.env.example` documents that default.

## Routes and API layer

- `/shopper` is the starting route for the shopper workflow.
- `/admin` is the starting route for the operations dashboard.
- `src/lib/api/types.ts` mirrors the local contract in `../docs/web-app-plan.md`.
- `src/lib/api/client.ts` contains typed local API requests and the named `state` event subscription helper.

Both `/shopper` (Phase 4) and `/admin` (Phase 5) use the local backend. `/shopper/preview` retains the independent sample-data UI from Phase 3.

## Admin local workflow (Phase 5)

Open `http://localhost:3001/admin` with the root backend on port 3000. The dashboard displays reported shelf status, workflow state, active baskets, confirmed carts, RSSI evidence, cases, timelines, and recent events. It uses explicit refresh; automatic updates remain Phase 6.

1. Start Basket A/B sessions in Shopper; Admin basket cards link to the correct Shopper basket.
2. Expand **Local simulator** at the bottom of Admin (development mode only), choose a lane, and send an event. The simulator refreshes Admin after submission. Shopper still requires Refresh basket to receive these changes.
3. Clear A/B picks update the appropriate cart when a session is active. Ambiguous pick asks Shopper A to confirm. Tied RSSI and unknown-zone events create staff cases. Put-back targets A. Duplicate delivery reuses the most recently successfully submitted event ID; it does not create a second cart mutation.
4. Filter cases by open, staff, customer, closed, or all. Select a case to inspect its evidence, proposed basket/action, confidence, tool records, and timeline.
5. For `OPEN_STAFF`, select A/B and Approve or Reject. Unknown candidates require a choice. Approval is disabled for inactive sessions or unmatched returns; the backend validates again. Rejection closes without changing a cart.
6. `WAITING_CUSTOMER` cases expose no staff decision controls; respond in Shopper. `CLOSED` cases display their resolution and are read-only.

Buttons are locked while mutations are in progress or fresh data is unavailable. Errors retain the last snapshot and refresh authoritative data; an uncertain decision response is not retried automatically.

Limits are shown honestly: case metrics count only the loaded snapshot (up to 30 cases); activity contains up to 20 recent events. RSSI is proximity evidence, not exact location. ONLINE is a backend-reported value without a health timeout. Agent evidence/tool calls are a local mock, not a Bedrock invocation. Staff authentication is not implemented for this localhost demo and remains a cloud/backend integration dependency.

Neither route requires AWS for these phases. The frontend uses the same local API through its development proxy; the old port-3000 browser app remains available for comparison.

## Shopper local API workflow (Phase 4)

1. Start the root backend on port 3000 and this frontend on port 3001.
2. Open `/shopper`, select Basket A or B, and start a session. The selection is stored locally when browser storage is available and reflected in `?basket=A` or `?basket=B`.
3. Open the original Staff dashboard at `http://127.0.0.1:3000` and send a simulator event. Products on the Shopper screen are informational and are not add-to-cart buttons.
4. Click **อัปเดตตะกร้า** (Refresh basket) to load the latest cart/cases. There is no polling or EventSource subscription on this screen yet; automatic realtime belongs to Phase 6.
5. For an ambiguous event, answer YES/NO. Mutations refresh the server snapshot automatically. YES may still route to staff if backend validation fails; NO routes to staff without changing the cart.
6. Resolve staff cases in the original Staff dashboard, then refresh Shopper. Cases without a candidate can block both baskets.
7. Mock checkout requires an active session, confirmed items, and backend `payable` status. It creates a local mock order, clears the cart, closes the session, and displays a receipt. No payment is processed.

The screen uses server prices, quantities, totals, case status, and order results. It prevents concurrent UI submissions, preserves confirmed data on errors, reloads authoritative state after failed/uncertain mutations, and disables checkout when the latest data cannot be loaded. Requests have a 12-second timeout and are not automatically retried.

### QR pairing

QR labels should contain a URL with `?basket=A` or `?basket=B`. Opening such a URL selects the basket; press Start session to begin. Successful camera detection or scanner manual selection selects the basket and starts/reuses its session.

The scanner uses the browser's `BarcodeDetector` and camera APIs where supported. Camera access needs HTTPS or localhost and user permission. Unsupported browsers, denied permission, and camera failures retain manual A/B selection. Closing, Escape, or successful detection stops camera tracks. The app extracts the basket ID and does not navigate to the QR URL.

No cloud resources or models are called by the default local workflow. Do not point the local proxy at a cloud endpoint until the team agrees on cloud authentication and usage limits.

## Shopper UI preview (Phase 3)

Open `/shopper/preview`. Use **Preview screen states** to inspect connection, empty cart, confirmed cart, uncertain pick/return, multiple cases, staff review, loading, submitting, load/action errors, disconnection, and receipt states.

- Basket selection, Start session, YES/NO, retry, and mock checkout buttons change sample preview state only. No HTTP API requests, EventSource connections, AWS calls, or model calls are made by this screen.
- Sample prices match the local contract: Coke THB 25 and Water THB 15. Pending items are excluded from displayed totals; checkout is disabled while review is pending or data is unavailable.
- QR shows a preview explanation and manual basket selection. Camera scanning and real session/cart/checkout integration belong to Phase 4; realtime integration belongs to Phase 6.
- Fixtures are in `src/components/shopper/sample-data.ts`; the screen and scoped responsive styling are in the same directory.
- Mock checkout receipts reflect the currently displayed confirmed sample lines. They do not represent a real order or payment.

Verification commands: `npm run lint`, `npm run typecheck`, and `npm run build`.

## Browser integration checks

With the frontend dev server running on port 3001:

```sh
npx playwright install chromium
npm run test:e2e
```

The first command downloads a local testing browser; it does not use AWS. `SHOPPER_TEST_ORIGIN` can point to a different frontend origin. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an existing Chromium executable.

The suite starts a copy of the real backend on an ephemeral port with temporary persistence, forwards only the test browser's API requests to it, and cleans it up. It does not reset the team's `data/demo-state.json` or change the frontend proxy configuration.

`npm run test:e2e` runs Shopper and Admin suites; `npm run test:admin` runs only Admin. Admin checks overview/evidence/filtering, approval/rejection, missing-session/return guards, duplicate submissions, simulator events, stale/concurrent-case/uncertain-response recovery, Shopper consistency, and mobile/desktop/landscape layout. Its server helper is in `tests/helpers/local-api.mjs`.

Checks cover session/cart integration, confirmed and duplicate events, customer YES/NO, returns, multiple cases, unknown-zone blocking, duplicate submissions, checkout/receipt/reload, failed requests and uncertain-response recovery, invalid JSON, QR fallback, simulated camera detection/denial/cleanup, responsive widths, and browser runtime/console errors. Camera APIs are simulated for repeatability; physical QR labels and a real phone camera still need a manual device check.

Responsive checks exercise connection, cart, confirmation, staff review, receipt, error, and scanner states at 320, 375, 390, 768, 1024, and 1440 px, plus 844x390 landscape. They check horizontal page overflow and clipped app controls. Set `SHOPPER_TEST_ARTIFACT_DIR` to an output directory to retain screenshots after the test; otherwise screenshots are temporary.
