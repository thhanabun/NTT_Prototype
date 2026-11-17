# FAST Web App

The Next.js App Router application in `web/` provides the Shopper PWA and Staff Admin. In local mode it talks to the Node API on port 3000 through a same-origin development proxy. In the hosted stack it uses the Cloud BFF, Cognito staff login, API Gateway, and the Cloud API; see [Cloud deployment status](../docs/cloud-deployment-status.md).

## Local setup

Use Node.js 20 or newer. From the repository root:

```powershell
npm ci
npm --prefix web ci
```

Start the API and its required local model/MQTT services using [local setup](../docs/local-setup.md). In another terminal:

```powershell
$env:LOCAL_API_ORIGIN = "http://127.0.0.1:3000"
npm --prefix web run dev:mock
```

Open <http://localhost:3001/shopper> or <http://localhost:3001/admin>. `dev:mock` enables the development-only Admin login simulation. It is not backend authorization and must not be exposed as a protected service. Cloud Admin uses Cognito/PKCE; do not reuse or publish local demo credentials.

## Shopper

- Choose Basket A/B or scan a QR containing `?basket=A` / `?basket=B`, then start/reuse a session.
- View backend-confirmed cart lines, quantity, price and total; pending/conflict items are excluded.
- Confirm or reject customer prompts; Staff review is handled in Admin.
- Mock checkout creates a demo order only; no real payment is processed.
- The FAST Shopper Agent is read-only. Local inference uses the configured OpenAI-compatible model endpoint; Cloud uses Bedrock Converse. It cannot change cart, orders or cases. See [Shopper Agent](../docs/shopper-agent.md).

## Staff Admin

- Monitor shelf state, basket RSSI, carts, cases, events, audit and Agent trace.
- Review/approve or reject open Staff cases; the backend revalidates decisions and prevents cart updates while an investigation is running.
- Use Stat Query for bounded read-only sales/product summaries. It is not arbitrary SQL.
- Object Detection can show the recorded annotated clip/map or connect the camera on the device opening Admin. Camera access requires permission and HTTPS (localhost is accepted for local development). Live camera points are analytics, not identity or basket ownership evidence. See [camera controls and calibration](../docs/admin-controls-camera.md) and [recorded detection](../docs/customer-detection.md).
- The simulator is a labeled demo source; it does not make a physical shelf online.

## Product mapping and safety

- `SHELF-01`: every valid lane maps to Cola.
- `SHELF-02`: every valid lane maps to Sprite Plus Tea.
- `SHELF-03`: Fanta floral bloom is a display label only; no product SKU is assigned by that label.
- RSSI indicates proximity, not who picked an item. Missing, stale or conflicting evidence routes to review.
- Only validated/confirmed lines count toward payable totals. Duplicate event IDs are idempotent; PUT_BACK cannot make quantity negative.

See [Shelf product mapping](../docs/shelf-product-mapping.md) and the [event contract](../docs/event-contract.md).

## Routes and implementation

| Route / file | Purpose |
| --- | --- |
| `/shopper` | Shopper session, cart, confirmation, checkout and Shopper Agent |
| `/admin` | Staff operations, cases, Agent trace, camera/map and Stat Query |
| `/admin/login` | Local development mock login or Cloud Cognito sign-in flow, depending on runtime |
| `src/app/api/[...path]/` | Same-origin API proxy routes |
| `src/lib/api/` | Typed API/realtime client; local SSE or Cloud WebSocket invalidation |

The older root `public/` PWA and port-3000 simulator remain for local comparison; new UI work belongs in `web/`.

## Checks

From `web/`:

```powershell
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

Run the relevant repository-level flow checks from the root only when validating changes; see [full-flow test boundaries](../docs/full-flow-test.md). Local fixture/browser suites do not verify AWS resources. Current Cloud checks and outstanding E2E work are tracked in [Cloud deployment status](../docs/cloud-deployment-status.md).
