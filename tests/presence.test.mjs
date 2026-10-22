import test from "node:test";
import assert from "node:assert/strict";
import { createPresenceTracker } from "../src/presence.mjs";

function setup(options = {}) {
  let t = 1_000_000;
  const tracker = createPresenceTracker({ now: () => t, ...options });
  return {
    tracker,
    advance: (ms) => { t += ms; },
    report: (shelfId, A = null, B = null, ageMs = {}) => tracker.ingest({ shelfId, rssi: { A, B }, ageMs }),
    zoneOf: (basketId) => tracker.snapshot().baskets.find((basket) => basket.basketId === basketId).zone,
  };
}

test("basket enters a shelf zone only at the enter threshold", () => {
  const { report, zoneOf } = setup();
  assert.equal(report("SHELF-01", -75).changed, true); // shelf comes online
  assert.equal(zoneOf("A"), null);
  assert.equal(report("SHELF-01", -68).changed, true);
  assert.equal(zoneOf("A"), "SHELF-01");
  assert.equal(zoneOf("B"), null);
});

test("hysteresis keeps the zone while RSSI wobbles and only RSSI changes do not publish", () => {
  const { report, zoneOf } = setup();
  report("SHELF-01", -65);
  for (const rssi of [-72, -78, -74, -79, -71]) {
    assert.equal(report("SHELF-01", rssi).changed, false);
    assert.equal(zoneOf("A"), "SHELF-01");
  }
  assert.equal(report("SHELF-01", -85).changed, true);
  assert.equal(zoneOf("A"), null);
});

test("another shelf takes over only with a clear margin", () => {
  const { report, zoneOf } = setup();
  report("SHELF-01", -66);
  report("SHELF-02", -63); // 3 dB stronger: not enough
  assert.equal(zoneOf("A"), "SHELF-01");
  assert.equal(report("SHELF-02", -59).changed, true); // 7 dB stronger
  assert.equal(zoneOf("A"), "SHELF-02");
});

test("stale readings and silent shelves expire on tick", () => {
  const { tracker, report, advance, zoneOf } = setup();
  report("SHELF-01", -60);
  advance(3000);
  assert.equal(tracker.tick(), false);
  assert.equal(zoneOf("A"), "SHELF-01");
  advance(1500);
  assert.equal(tracker.tick(), true);
  assert.equal(zoneOf("A"), null);
  assert.equal(tracker.snapshot().shelves[0].online, false);
});

test("device-reported packet age counts toward staleness", () => {
  const { report, zoneOf } = setup();
  report("SHELF-01", -60, null, { A: 5000 });
  assert.equal(zoneOf("A"), null);
});

test("a confirmed pick pins the basket to that shelf, then RSSI takes over again", () => {
  const { tracker, report, advance, zoneOf } = setup();
  report("SHELF-02", -60);
  assert.equal(tracker.confirmPick("A", "SHELF-01"), true);
  const pinned = tracker.snapshot().baskets[0];
  assert.equal(pinned.zone, "SHELF-01");
  assert.equal(pinned.source, "PICK");
  report("SHELF-02", -55);
  assert.equal(zoneOf("A"), "SHELF-01");
  advance(8001);
  report("SHELF-02", -55);
  assert.equal(zoneOf("A"), "SHELF-02");
  assert.equal(tracker.snapshot().baskets[0].source, "RSSI");
});

test("invalid RSSI is ignored and invalid shelf IDs are rejected", () => {
  const { tracker, report, zoneOf } = setup();
  report("SHELF-01", 12, "loud");
  assert.equal(zoneOf("A"), null);
  assert.equal(tracker.snapshot().baskets[0].rssi["SHELF-01"], null);
  assert.throws(() => tracker.ingest({ shelfId: "../etc", rssi: {} }), /valid shelfId/);
  assert.throws(() => tracker.ingest([]), /JSON object/);
  assert.equal(tracker.confirmPick("Z", "SHELF-01"), false);
});

test("the number of shelves is bounded", () => {
  const { tracker } = setup({ maxShelves: 2 });
  tracker.ingest({ shelfId: "SHELF-01" });
  tracker.ingest({ shelfId: "SHELF-02" });
  assert.throws(() => tracker.ingest({ shelfId: "SHELF-03" }), /Too many shelves/);
});
