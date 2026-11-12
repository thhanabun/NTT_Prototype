import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, presenceCheck, processShelfEvent, snapshot, startSession } from "../src/domain.mjs";
import { createPrototypeApplication } from "../src/application.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { runAgentTool } from "../src/agent/tools.mjs";

const pick = eventId => ({ eventId, shelfId: "SHELF-02", laneId: "LANE-1", eventType: "PICK", rssi: { A: -60, B: null } });
// The water buyer: a shopper with no basket stands nearer Shelf 2 than Basket A.
const waterBuyer = (source = "LIVE_CAMERA") => ({ status: "AVAILABLE", at: new Date().toISOString(), windowMs: 1500, shelfId: "SHELF-02", cameras: ["CAM-01"], source,
  inZone: [{ shopperId: "S-0002", tag: null, linkedBy: null, distanceM: 0.2 }, { shopperId: "S-0001", tag: "A", linkedBy: "PRESENCE", distanceM: 0.9 }] });

test("presence check: anonymous nearer than the chosen basket would block; otherwise OK or NO_DATA", () => {
  assert.equal(presenceCheck(waterBuyer(), "A"), "WOULD_BLOCK");
  assert.equal(presenceCheck({ ...waterBuyer(), inZone: [...waterBuyer().inZone].reverse().map((e, i) => ({ ...e, distanceM: i ? 0.9 : 0.2 })) }, "A"), "OK");
  assert.equal(presenceCheck({ ...waterBuyer(), inZone: [waterBuyer().inZone[0]] }, "A"), "WOULD_BLOCK", "linked basket not seen at the shelf");
  assert.equal(presenceCheck({ status: "STALE", inZone: [] }, "A"), "NO_DATA");
  assert.equal(presenceCheck(undefined, "A"), "NO_DATA");
});

test("guard off (default): the cart updates as today, presence is stored and the audit says WOULD_BLOCK", () => {
  const store = createStore();
  startSession(store, "A");
  const result = processShelfEvent(store, pick("water-1"), { presence: waterBuyer() });
  assert.equal(result.disposition, "CONFIRMED");
  assert.equal(store.events[0].presence.inZone.length, 2);
  const audit = store.auditLog.find(entry => entry.action === "CART_UPDATED");
  assert.equal(audit.details.presenceCheck, "WOULD_BLOCK");
  assert.equal(snapshot(store).policy.presenceGuard, false);
});

test("guard on: a live-camera WOULD_BLOCK becomes a staff case; test video never blocks", async () => {
  process.env.PRESENCE_GUARD = "on";
  try {
    const guarded = await import("../src/domain.mjs?guard=on");
    const store = guarded.createStore();
    guarded.startSession(store, "A");
    const blocked = guarded.processShelfEvent(store, pick("water-2"), { presence: waterBuyer() });
    assert.equal(blocked.disposition, "PENDING");
    const item = store.cases[0];
    assert.equal(item.type, "PRESENCE_CONFLICT");
    assert.equal(item.nextAction, "STAFF_HITL");
    assert.equal(item.evidence.presence.inZone[0].tag, null);
    assert.deepEqual(store.carts.A, {});
    assert.throws(() => guarded.checkout(store, "A"), /Resolve pending cases/);
    const rehearsal = guarded.processShelfEvent(store, pick("water-3"), { presence: waterBuyer("TEST_VIDEO") });
    assert.equal(rehearsal.disposition, "CONFIRMED");
  } finally { delete process.env.PRESENCE_GUARD; }
});

test("application ignores presence sent by a device and records its own snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "presence-app-"));
  try {
    const app = createPrototypeApplication({ repository: new LocalJsonRepository(join(directory, "state.json")), logger: () => {}, agentProvider: "mock" });
    await app.init();
    await app.startSession("A");
    await app.processShelfEvent({ ...pick("forged-1"), presence: waterBuyer() });
    const state = await app.getState();
    assert.equal(state.recentEvents[0].presence.status, "NO_CAMERA");
    assert.equal(state.baskets[0].total, 15);
    await assert.rejects(app.ingestVisionTracks({ cameraId: "CAM-01", source: "LIVE_CAMERA", capturedAt: "x", tracks: [] }), /capturedAt/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("get_shopper_presence returns the event snapshot with its limitation, or NO_DATA", () => {
  const store = createStore();
  startSession(store, "A");
  processShelfEvent(store, pick("p-1"), { presence: waterBuyer() });
  processShelfEvent(store, { ...pick("p-2"), eventId: "p-2" });
  const found = runAgentTool(store, "get_shopper_presence", { eventId: "p-1" });
  assert.equal(found.status, "AVAILABLE");
  assert.match(found.limitation, /not proof of who picked/);
  assert.equal(runAgentTool(store, "get_shopper_presence", { eventId: "p-2" }).status, "NO_DATA");
});
