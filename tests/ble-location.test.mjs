import test from "node:test";
import assert from "node:assert/strict";
import { createStore, processShelfEvent, snapshot, startSession } from "../src/domain.mjs";
import { ingestTelemetry } from "../src/evidence.mjs";
import { bleLocations, updateBleLocation } from "../src/ble-location.mjs";
import { BLE_LOCATION_CONFIG } from "../src/ble-location-config.mjs";
import { scopedState } from "../src/cloud/auth.mjs";

const SHELF_IDS = ["SHELF-01", "SHELF-02", "SHELF-03"];
const pointFingerprints = [
    { x: 1, y: 2, zone: "A", rssi: { "SHELF-01": -60, "SHELF-02": -80, "SHELF-03": -80 } },
    { x: 4, y: 5, zone: "B", rssi: { "SHELF-01": -80, "SHELF-02": -60, "SHELF-03": -80 } },
    { x: 7, y: 8, zone: "C", rssi: { "SHELF-01": -80, "SHELF-02": -80, "SHELF-03": -60 } },
  ];
const config = {
  tags: {
    A: { enterRssiDbm: -65, exitRssiDbm: -75, fingerprints: pointFingerprints },
    B: { enterRssiDbm: -65, exitRssiDbm: -75, fingerprints: pointFingerprints },
    HV01: { enterRssiDbm: -65, exitRssiDbm: -75, fingerprints: pointFingerprints },
  },
};

function sendWindow(store, second, readings, source = "DEVICE") {
  const at = Date.parse("2026-11-14T04:00:00.000Z") + second * 1000;
  for (const shelfId of SHELF_IDS) {
    ingestTelemetry(store, { shelfId, source, rssi: readings[shelfId] || readings }, new Date(at).toISOString());
  }
  updateBleLocation(store, at, config);
  return at;
}

test("BLE coverage enters after two windows, holds through the deadband, and exits after three weak windows", () => {
  const store = createStore();
  const inside = { A: -60, B: -80, HV01: -80 };
  const deadband = { A: -70, B: -70, HV01: -70 };
  const outside = { A: -80, B: -80, HV01: -80 };

  sendWindow(store, 0, inside);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:00.000Z"), config).find(item => item.tagId === "A").presence, "UNKNOWN");
  sendWindow(store, 1, inside);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:01.000Z"), config).find(item => item.tagId === "A").presence, "INSIDE");

  sendWindow(store, 2, deadband);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:02.000Z"), config).find(item => item.tagId === "A").presence, "INSIDE");
  sendWindow(store, 3, outside);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:03.000Z"), config).find(item => item.tagId === "A").presence, "INSIDE");
  sendWindow(store, 4, outside);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:04.000Z"), config).find(item => item.tagId === "A").presence, "INSIDE");
  sendWindow(store, 5, outside);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:05.000Z"), config).find(item => item.tagId === "A").presence, "OUTSIDE");
});

test("one strong reader can trigger entry; three active readers with no tag sighting can trigger exit", () => {
  const store = createStore();
  const oneReader = {
    "SHELF-01": { A: -60, B: null, HV01: null },
    "SHELF-02": { A: null, B: null, HV01: null },
    "SHELF-03": { A: null, B: null, HV01: null },
  };
  const noSightings = { A: null, B: null, HV01: null };
  sendWindow(store, 0, oneReader);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:00.000Z"), config)[0].presence, "UNKNOWN");
  sendWindow(store, 1, oneReader);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:01.000Z"), config)[0].presence, "INSIDE");
  for (const second of [2, 3, 4]) sendWindow(store, second, noSightings);
  assert.equal(bleLocations(store, Date.parse("2026-11-14T04:00:04.000Z"), config)[0].presence, "OUTSIDE");
});

test("stale or misaligned receiver telemetry cannot advance entry or exit counters", () => {
  const store = createStore();
  const at = Date.parse("2026-11-14T04:00:00.000Z");
  for (const shelfId of SHELF_IDS) ingestTelemetry(store, { shelfId, rssi: { A: -60, B: -80, HV01: -80 } }, new Date(at).toISOString());
  updateBleLocation(store, at, config);
  for (const second of [6, 7, 8]) {
    const next = at + second * 1000;
    for (const shelfId of SHELF_IDS.slice(0, 2)) ingestTelemetry(store, { shelfId, rssi: { A: -80, B: -80, HV01: -80 } }, new Date(next).toISOString());
    updateBleLocation(store, next, config);
  }
  const location = bleLocations(store, at + 8000, config)[0];
  assert.equal(location.status, "PARTIAL");
  assert.equal(location.presence, "PARTIAL");
  assert.equal(location.x, null);
});

test("hysteresis waits until all three readers report a new sample", () => {
  const store = createStore();
  const base = Date.parse("2026-11-14T04:00:00.000Z");
  const inside = { A: -60, B: -80, HV01: -80 };
  for (const shelfId of SHELF_IDS) {
    ingestTelemetry(store, { shelfId, source: "DEVICE", rssi: inside }, new Date(base).toISOString());
    updateBleLocation(store, base, config);
  }
  assert.equal(store.bleLocationState.A.enterCount, 1);

  for (const shelfId of SHELF_IDS.slice(0, 2)) {
    ingestTelemetry(store, { shelfId, source: "DEVICE", rssi: inside }, new Date(base + 1000).toISOString());
    updateBleLocation(store, base + 1000, config);
  }
  assert.equal(store.bleLocationState.A.presence, "UNKNOWN");
  assert.equal(store.bleLocationState.A.enterCount, 1);

  ingestTelemetry(store, { shelfId: SHELF_IDS[2], source: "DEVICE", rssi: inside }, new Date(base + 1000).toISOString());
  updateBleLocation(store, base + 1000, config);
  assert.equal(store.bleLocationState.A.presence, "INSIDE");
});

test("delayed measurements are aligned by capture time, not delivery time", () => {
  const store = createStore();
  const now = Date.parse("2026-11-14T04:00:10.000Z");
  const captureTimes = [now - 5000, now - 3000, now - 2500];
  for (const [index, shelfId] of SHELF_IDS.entries()) {
    ingestTelemetry(store, {
      shelfId,
      source: "DEVICE",
      capturedAt: new Date(captureTimes[index]).toISOString(),
      rssi: { A: -60, B: -80, HV01: -80 },
    }, new Date(now).toISOString());
    updateBleLocation(store, now, config);
  }

  const location = bleLocations(store, now, config).find(item => item.tagId === "A");
  assert.equal(location.status, "PARTIAL");
  assert.equal(location.x, null);
  assert.equal(store.bleLocationState.A, undefined);
});

test("BLE position uses the calibrated three-reader fingerprint and only exposes fresh aligned readings", () => {
  const store = createStore();
  const pointA = {
    "SHELF-01": { A: -60, B: -80, HV01: -80 },
    "SHELF-02": { A: -80, B: -80, HV01: -80 },
    "SHELF-03": { A: -80, B: -80, HV01: -80 },
  };
  const at = sendWindow(store, 0, pointA);
  const waiting = bleLocations(store, at, config).find(item => item.tagId === "A");
  assert.equal(waiting.status, "WAITING");
  assert.equal(waiting.x, null);
  sendWindow(store, 1, pointA);
  const location = bleLocations(store, at + 1100, config).find(item => item.tagId === "A");
  assert.equal(location.status, "TRACKING");
  assert.deepEqual({ x: location.x, y: location.y, zone: location.zone }, { x: 1, y: 2, zone: "A" });

  const stale = bleLocations(store, at + 7000, config).find(item => item.tagId === "A");
  assert.equal(stale.status, "STALE");
  assert.equal(stale.x, null);
});

test("uncalibrated defaults report no fabricated position", () => {
  const location = snapshot(createStore()).bleLocations.find(item => item.tagId === "A");
  assert.equal(location.status, "UNCALIBRATED");
  assert.equal(location.x, null);
  assert.equal(location.y, null);
});

test("BLE location telemetry never changes transaction events or carts", () => {
  const store = createStore();
  processShelfEvent(store, { eventId: "ble-location-event", laneId: "LANE-1", eventType: "PICK", rssi: { A: -55, B: -80 } });
  const before = structuredClone({ events: store.events, cases: store.cases, carts: store.carts, shelf: store.shelf });
  sendWindow(store, 0, { A: -60, B: -80, HV01: -80 });
  assert.deepEqual({ events: store.events, cases: store.cases, carts: store.carts, shelf: store.shelf }, before);
});

test("staff sees calibrated locations while public and shopper snapshots stay empty", () => {
  const originalTags = BLE_LOCATION_CONFIG.tags;
  const calibrated = { enterRssiDbm: -65, exitRssiDbm: -75, fingerprints: pointFingerprints.slice(0, 1) };
  BLE_LOCATION_CONFIG.tags = { A: calibrated, B: calibrated, HV01: calibrated };
  try {
    const store = createStore();
    const current = Date.now();
    for (const at of [current - 1000, current]) {
      for (const shelfId of SHELF_IDS) {
        const rssi = { A: -80, B: -80, HV01: -80 };
        if (shelfId === "SHELF-01") rssi.A = -60;
        ingestTelemetry(store, { shelfId, source: "DEVICE", rssi }, new Date(at).toISOString());
      }
    }
    const session = startSession(store, "A");
    const staff = scopedState(store, { role: "STAFF" });
    const shopper = scopedState(store, { role: "SHOPPER", basketId: "A", sessionId: session.sessionId });
    const publicState = scopedState(store, { role: "PUBLIC" });
    assert.deepEqual({ x: staff.bleLocations[0].x, y: staff.bleLocations[0].y }, { x: 1, y: 2 });
    assert.equal(shopper.bleLocations[0].x, null);
    assert.equal(publicState.bleLocations[0].x, null);
  } finally {
    BLE_LOCATION_CONFIG.tags = originalTags;
  }
});
