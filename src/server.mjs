import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepository } from "./store-repository.mjs";
import { createPrototypeApplication } from "./application.mjs";
import { logEvent } from "./logger.mjs";
import { createPresenceTracker, presenceConfigFromEnv } from "./presence.mjs";
import { createLayoutStore } from "./store-layout.mjs";
import { PATH_LOSS_DEFAULTS, createPositioner, createTuningStore, proposeAnchors } from "./positioning.mjs";

const root = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const dataDir = resolve(root, "../data");
const statePath = resolve(process.env.STORE_PATH || resolve(dataDir, "demo-state.json"));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const repository = createRepository({
  backend: process.env.STORE_BACKEND || "local",
  statePath,
  tableName: process.env.DYNAMODB_TABLE_NAME,
});
const subscribers = new Set();
let application;

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function publish() {
  const message = "event: state\ndata: " + JSON.stringify(application.getSnapshot()) + "\n\n";
  for (const response of subscribers) response.write(message);
}

// Store floor plan edited in Admin; pushed to every open page when it is saved.
const layoutStore = createLayoutStore({ path: resolve(process.env.STORE_LAYOUT_PATH || resolve(dataDir, "store-layout.json")) });
await layoutStore.load();
const layoutMessage = () => "event: layout\ndata: " + JSON.stringify(layoutStore.get()) + "\n\n";
function publishLayout() {
  const message = layoutMessage();
  for (const response of subscribers) response.write(message);
}

// Store-map presence (shelf zones) plus indoor positioning (basket x, y from anchor ESP32s).
// Separate from cart state; pushed when a zone changes or a basket moves noticeably.
const presence = createPresenceTracker(presenceConfigFromEnv());
const envNumber = (name) => (process.env[name] !== undefined && Number.isFinite(Number(process.env[name])) ? Number(process.env[name]) : null);
// Values set on the tuning page (/admin/tuning) win over the env defaults below.
const tuningStore = createTuningStore({ path: resolve(process.env.POSITION_TUNING_PATH || resolve(dataDir, "positioning-tuning.json")) });
await tuningStore.load();
const positioner = createPositioner({
  basketTxPower: envNumber("POSITION_BASKET_TX_POWER"),
  basketOffsetDb: envNumber("POSITION_BASKET_OFFSET_DB") ?? 0,
  getTuning: () => tuningStore.get(),
});
const anchorModel = { ...PATH_LOSS_DEFAULTS, txPower: envNumber("POSITION_ANCHOR_TX_POWER") ?? PATH_LOSS_DEFAULTS.txPower };
const presenceSnapshot = () => ({ ...presence.snapshot(), positioning: positioner.snapshot(layoutStore.get()) });
const presenceMessage = () => "event: presence\ndata: " + JSON.stringify(presenceSnapshot()) + "\n\n";
let lastPresencePush = 0;
let pendingPresencePush = null;
// Position updates can be frequent; send at most every 400 ms.
function publishPresence() {
  if (pendingPresencePush) return;
  const wait = Math.max(0, lastPresencePush + 400 - Date.now());
  pendingPresencePush = setTimeout(() => {
    pendingPresencePush = null;
    lastPresencePush = Date.now();
    const message = presenceMessage();
    for (const response of subscribers) response.write(message);
  }, wait);
}
function updatePositions() {
  return positioner.update(layoutStore.get(), presence.links(), presence.basketReadings());
}
setInterval(() => { if (presence.tick() | updatePositions()) publishPresence(); }, 1000).unref();

application = createPrototypeApplication({
  repository,
  onStateChange: publish,
  agentProvider: process.env.AGENT_PROVIDER || "laya",
});
await application.init();

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    return sendJson(response, 200, await application.getState());
  }
  if (request.method === "GET" && url.pathname === "/api/stream") {
    const state = await application.getState();
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write("retry: 1500\n\n");
    response.write("event: state\ndata: " + JSON.stringify(state) + "\n\n");
    response.write(presenceMessage());
    response.write(layoutMessage());
    subscribers.add(response);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    response.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(response);
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/presence") {
    return sendJson(response, 200, presenceSnapshot());
  }
  if (request.method === "GET" && url.pathname === "/api/store-layout") {
    return sendJson(response, 200, layoutStore.get());
  }
  // Suggested ESP32 positions from anchor-to-anchor RSSI; Admin reviews them before saving.
  if (request.method === "GET" && url.pathname === "/api/positioning/auto-place") {
    const tuning = tuningStore.get();
    const model = { txPower: tuning.anchorTxPower ?? anchorModel.txPower, n: tuning.n ?? anchorModel.n };
    return sendJson(response, 200, proposeAnchors(layoutStore.get(), presence.links(), model));
  }
  if (request.method === "GET" && url.pathname === "/api/positioning/tuning") {
    return sendJson(response, 200, tuningStore.get());
  }

  if (request.method === "GET" && url.pathname === "/api/audit") {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const caseId = url.searchParams.get("caseId");
    const eventId = url.searchParams.get("eventId");
    return sendJson(response, 200, await application.getAudit({ caseId, eventId, limit }));
  }

  const body = await readJson(request);
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const session = await application.startSession(String(body.basketId || "").toUpperCase());
    return sendJson(response, 201, { session });
  }
  if (request.method === "POST" && url.pathname === "/api/events") {
    const result = await application.processShelfEvent(body);
    if (result.disposition === "CONFIRMED" && presence.confirmPick(result.basketId, result.event?.shelfId)) {
      publishPresence();
    }
    return sendJson(response, 200, result);
  }
  if (request.method === "PUT" && url.pathname === "/api/store-layout") {
    const layout = await layoutStore.save(body);
    publishLayout();
    updatePositions();
    publishPresence();
    return sendJson(response, 200, layout);
  }
  if (request.method === "DELETE" && url.pathname === "/api/store-layout") {
    const layout = await layoutStore.reset();
    publishLayout();
    updatePositions();
    publishPresence();
    return sendJson(response, 200, layout);
  }
  if ((request.method === "PUT" || request.method === "DELETE") && url.pathname === "/api/positioning/tuning") {
    const tuning = request.method === "PUT" ? await tuningStore.save(body) : await tuningStore.reset();
    updatePositions();
    publishPresence();
    return sendJson(response, 200, tuning);
  }
  if (request.method === "POST" && url.pathname === "/api/presence") {
    const { changed } = presence.ingest(body);
    if (changed | updatePositions()) publishPresence();
    return sendJson(response, 200, { ok: true, changed });
  }
  if (request.method === "POST" && url.pathname === "/api/reset") {
    await application.reset();
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/checkout") {
    const order = await application.checkout(String(body.basketId || "").toUpperCase());
    return sendJson(response, 200, { order });
  }

  const caseRoute = url.pathname.match(/^\/api\/cases\/([^/]+)\/(customer|staff)$/);
  if (request.method === "POST" && caseRoute) {
    const caseId = decodeURIComponent(caseRoute[1]);
    const caseItem = await application.decideCase(caseId, caseRoute[2], body);
    return sendJson(response, 200, { case: caseItem });
  }
  return sendJson(response, 404, { error: "API route not found" });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const contents = await readFile(path);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(path)] || "application/octet-stream",
      "cache-control": path.endsWith("sw.js") ? "no-cache" : "public, max-age=300",
    });
    response.end(contents);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://" + (request.headers.host || host));
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    logEvent("ERROR", "HTTP_REQUEST_FAILED", {
      method: request.method,
      path: request.url,
      message: error.message || "Request failed",
    });
    const status = error instanceof SyntaxError ? 400 : 409;
    if (!response.headersSent) sendJson(response, status, { error: error.message || "Request failed" });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log("Smart Basket prototype listening at http://" + host + ":" + port);
});
