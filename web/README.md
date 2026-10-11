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

The Admin route is scaffolding for Phase 2. The Shopper route now contains the Phase 3 UI preview, using local sample fixtures only.

## Shopper UI preview (Phase 3)

Open `/shopper`. Use **Preview screen states** to inspect connection, empty cart, confirmed cart, uncertain pick/return, multiple cases, staff review, loading, submitting, load/action errors, disconnection, and receipt states.

- Basket selection, Start session, YES/NO, retry, and mock checkout buttons change sample preview state only. No HTTP API requests, EventSource connections, AWS calls, or model calls are made by this screen.
- Sample prices match the local contract: Coke THB 25 and Water THB 15. Pending items are excluded from displayed totals; checkout is disabled while review is pending or data is unavailable.
- QR shows a preview explanation and manual basket selection. Camera scanning and real session/cart/checkout integration belong to Phase 4; realtime integration belongs to Phase 6.
- Fixtures are in `src/components/shopper/sample-data.ts`; the screen and scoped responsive styling are in the same directory.
- Mock checkout receipts reflect the currently displayed confirmed sample lines. They do not represent a real order or payment.

Verification commands: `npm run lint`, `npm run typecheck`, and `npm run build`.
