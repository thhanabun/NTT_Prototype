import test from "node:test";
import assert from "node:assert/strict";
import { createPresence, validateTracksMessage } from "../src/presence.mjs";
import { DEFAULT_STORE_MAP, validateStoreMap } from "../src/store-map.mjs";

// Default map: 100 units = 10 m, so 1 unit = 0.1 m. Shelf 2 box x 40–60, y 10–18; its zone grows by 10 units.
const map = validateStoreMap(DEFAULT_STORE_MAP);
const T0 = Date.parse("2026-11-13T10:00:00Z");
function setup() {
  let now = T0;
  const presence = createPresence({ getMap: () => map, now: () => now });
  const at = ms => { now = T0 + ms; return new Date(now).toISOString(); };
  const send = (ms, cameraId, tracks, source = "LIVE_CAMERA") => presence.ingestTracks({ cameraId, source, capturedAt: at(ms),
    tracks: tracks.map(([trackId, x, y, occluded = false]) => ({ trackId, confidence: .9, box: [0, 0, 10, 10], floor: { x, y }, occluded })) });
  const hear = (ms, shelfId, rssi) => { at(ms); return presence.ingestTelemetry({ shelfId, receivedAt: new Date(T0 + ms).toISOString(), rssi }); };
  return { presence, send, at, hear };
}

test("two cameras seeing one person make one shopper", () => {
  const { presence, send } = setup();
  send(0, "CAM-01", [[1, 50, 30]]);
  send(200, "CAM-02", [[4, 52, 31]]);
  const shoppers = presence.view().shoppers;
  assert.equal(shoppers.length, 1);
  assert.deepEqual(shoppers[0].cameras.sort(), ["CAM-01", "CAM-02"]);
});

test("a new tracker ID near a lost shopper keeps the same shopper; far away makes a new one", () => {
  const { presence, send } = setup();
  send(0, "CAM-01", [[1, 50, 30]]);
  const id = presence.view().shoppers[0].shopperId;
  send(2000, "CAM-01", [[9, 55, 32]]);
  assert.deepEqual(presence.view().shoppers.map(s => s.shopperId), [id]);
  send(2500, "CAM-01", [[9, 55, 32], [10, 90, 60]]);
  assert.equal(presence.view().shoppers.length, 2);
  send(9000, "CAM-01", [[11, 20, 20]]);
  assert.deepEqual(presence.view().shoppers.map(s => s.shopperId).includes(id), false, "unseen for 5 s closes the shopper");
});

test("overlapping view is ignored while another camera sees the person clearly", () => {
  const { presence, send } = setup();
  send(0, "CAM-01", [[1, 30, 30], [2, 70, 30]]);
  send(100, "CAM-02", [[5, 30, 30], [6, 70, 30]]);
  send(600, "CAM-02", [[5, 34, 30], [6, 66, 30]]);
  send(700, "CAM-01", [[1, 60, 30, true], [2, 40, 30, true]]); // CAM-01 swapped IDs while they overlap
  const byCam = Object.fromEntries(presence.view().shoppers.map(s => [s.tracks.find(t => t.cameraId === "CAM-02").trackId, s.x]));
  assert.equal(byCam[5], 34);
  assert.equal(byCam[6], 66);
});

test("a tag links to the only shopper at its shelf after 3 s, never with two shoppers there", () => {
  const { presence, send, hear } = setup();
  const strongAt2 = { A: -55, B: null };
  for (let ms = 0; ms <= 4000; ms += 500) {
    send(ms, "CAM-01", [[1, 50, 22], [2, 52, 24]]);
    hear(ms, "SHELF-02", strongAt2); hear(ms, "SHELF-01", { A: -75, B: null });
  }
  assert.ok(presence.view().shoppers.every(s => s.tag === null), "two people at the shelf: wait");
  const changes = [];
  for (let ms = 4500; ms <= 9000; ms += 500) {
    changes.push(...send(ms, "CAM-01", [[1, 50, 22], [2, 90, 60]]), ...hear(ms, "SHELF-02", strongAt2));
  }
  const linked = presence.view().shoppers.find(s => s.tag === "A");
  assert.equal(linked?.tracks[0].trackId, 1);
  assert.equal(changes.filter(c => c.type === "LINKED").length, 1);
  assert.equal(presence.view().tags.A.zone, "SHELF-02");
});

test("staff override wins, and a silent tag unlinks after 10 s", () => {
  const { presence, send, hear } = setup();
  send(0, "CAM-01", [[1, 50, 22], [2, 80, 60]]);
  const [first, second] = presence.view().shoppers;
  hear(0, "SHELF-02", { A: -55, B: null });
  presence.setLink(second.shopperId, "A");
  for (let ms = 500; ms <= 6000; ms += 500) { send(ms, "CAM-01", [[1, 50, 22], [2, 80, 60]]); hear(ms, "SHELF-02", { A: -55, B: null }); }
  assert.equal(presence.view().shoppers.find(s => s.tag === "A").shopperId, second.shopperId);
  assert.throws(() => presence.setLink("S-9999", "A"), /not found/);
  for (let ms = 6500; ms <= 17000; ms += 500) { send(ms, "CAM-01", [[1, 50, 22], [2, 80, 60]]); hear(ms, "SHELF-02", { A: null, B: null }); }
  assert.ok(presence.view().shoppers.every(s => s.tag === null));
  assert.ok(first);
});

test("snapshot lists shoppers in the shelf zone by distance, with source and status", () => {
  const { presence, send, at } = setup();
  at(0);
  assert.equal(presence.snapshotAt("SHELF-02").status, "NO_CAMERA");
  send(0, "CAM-01", [[1, 50, 26], [2, 50, 20], [3, 90, 60]], "TEST_VIDEO");
  const snap = presence.snapshotAt("SHELF-02");
  assert.equal(snap.status, "AVAILABLE");
  assert.equal(snap.source, "TEST_VIDEO");
  assert.deepEqual(snap.inZone.map(s => s.distanceM), [0.2, 0.8]);
  at(3000);
  assert.equal(presence.snapshotAt("SHELF-02").status, "STALE");
});

test("track messages are validated at the boundary", () => {
  const ok = { cameraId: "CAM-01", source: "LIVE_CAMERA", capturedAt: new Date().toISOString(), tracks: [] };
  assert.doesNotThrow(() => validateTracksMessage(ok, map));
  for (const bad of [{ ...ok, cameraId: "x" }, { ...ok, source: "MOCK" }, { ...ok, tracks: Array(13).fill({}) },
    { ...ok, tracks: [{ trackId: 1, confidence: 2, box: [0, 0, 1, 1], floor: null, occluded: false }] },
    { ...ok, tracks: [{ trackId: 1, confidence: .5, box: [0, 0, 1, 1], floor: { x: 500, y: 1 }, occluded: false }] }]) {
    assert.throws(() => validateTracksMessage(bad, map));
  }
});
