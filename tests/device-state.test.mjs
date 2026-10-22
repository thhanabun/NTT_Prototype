import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, startSession, processShelfEvent, snapshot } from "../src/domain.mjs";
import { ingestTelemetry } from "../src/evidence.mjs";
import { deviceState } from "../src/device-state.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { createPrototypeApplication } from "../src/application.mjs";
import { startLocalApi } from "../web/tests/helpers/local-api.mjs";

const at = "2026-10-22T11:00:00Z";
const input = { shelfId: "SHELF-01", rssi: { A: -74, B: null, HV01: -65 }, lanes: [{ laneId: "LANE-1", present: true }, { laneId: "LANE-2", present: false }], uptimeMs: 12000, queueDepth: 0, droppedEvents: 0 };

test("Device state uses real telemetry, expires silent devices and never infers heartbeat from events/mock data", () => {
  const store = createStore();
  assert.equal(deviceState(store).status, "UNKNOWN");
  ingestTelemetry(store, { ...input, source: "MOCK" }, at);
  assert.equal(deviceState(store, Date.parse(at)).status, "UNKNOWN");
  ingestTelemetry(store, input, at);
  assert.equal(deviceState(store, Date.parse(at) + 5000).status, "ONLINE");
  assert.deepEqual(snapshot(store, Date.parse(at)).shelf.device.rssi, input.rssi);
  const stale = deviceState(store, Date.parse(at) + 5001);
  assert.equal(stale.status, "OFFLINE"); assert.equal(stale.lastSeenAt, at);
  assert.deepEqual(stale.rssi, { A: null, B: null, HV01: null }); assert.deepEqual(stale.lanes, []);
  assert.equal(stale.uptimeMs, null);
});

test("Current device state cannot rewrite event RSSI, decisions, cart or the transaction FSM", () => {
  const store = createStore(); startSession(store, "A");
  processShelfEvent(store, { eventId: "preserved-event", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -57 } });
  const before = structuredClone({ events: store.events, cases: store.cases, carts: store.carts, shelf: store.shelf });
  ingestTelemetry(store, { ...input, rssi: { A: -80, B: -50, HV01: -60 } }, at);
  const next = snapshot(store, Date.parse(at));
  assert.deepEqual(next.shelf.rssi, before.shelf.rssi);
  assert.equal(next.shelf.device.rssi.B, -50);
  assert.deepEqual({ events: store.events, cases: store.cases, carts: store.carts, shelf: store.shelf }, before);
});

test("Ingested DEVICE evidence broadcasts a persisted current state without cart mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basket-device-"));
  try {
    const updates = [];
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    const app = createPrototypeApplication({ repository, logger: () => {}, onStateChange: value => updates.push(value) });
    await app.init();
    await app.ingestEvidence("telemetry", input);
    assert.equal(updates.length, 1); assert.equal(updates[0].shelf.device.status, "ONLINE");
    assert.equal(updates[0].shelf.device.lanes[0].present, true);
    const reloaded = new LocalJsonRepository(repository.path); await reloaded.init();
    assert.equal(snapshot(await reloaded.read()).shelf.device.uptimeMs, 12000);
    assert.deepEqual((await repository.read()).carts, { A: {}, B: {} });
    await app.ingestEvidence("telemetry", { ...input, source: "MOCK" });
    assert.equal(updates.length, 1, "Mock fixture telemetry cannot impersonate a live device update");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Native SSE delivers telemetry and OFFLINE after silence without a manual GET or fabricated samples", async () => {
  const api = await startLocalApi();
  const controller = new AbortController();
  let reader;
  try {
    const response = await fetch(api.origin + "/api/stream", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
    reader = response.body.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    async function until(status) {
      while (true) {
        const { value, done } = await reader.read(); assert.equal(done, false);
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").find(line => line.startsWith("data: "));
          if (data) { const state = JSON.parse(data.slice(6)); if (state.shelf.device.status === status) return state; }
        }
      }
    }
    await until("UNKNOWN");
    const posted = await fetch(api.origin + "/api/telemetry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); assert.ok(posted.ok);
    assert.equal((await until("ONLINE")).shelf.device.rssi.A, -74);
    const offline = await until("OFFLINE"); assert.equal(offline.shelf.device.rssi.A, null);
    assert.equal(offline.shelf.fsmState, "IDLE"); assert.equal(offline.baskets[0].total, 0);
  } finally { controller.abort(); await reader?.cancel().catch(() => {}); await api.close(); }
});
