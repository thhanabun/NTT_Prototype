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

The route pages are scaffolding for Phase 2. Shopper and Admin workflows are implemented in later phases.
