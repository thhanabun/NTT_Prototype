import test from "node:test";
import assert from "node:assert/strict";
import {
  PATH_LOSS_DEFAULTS, alignTo, anchorPositions, createPositioner, fitPathLoss, locate, relativePlacement, rssiToMeters,
} from "../src/positioning.mjs";

const model = { txPower: -59, n: 2 };
const rssiAt = (meters, m = model) => m.txPower - 10 * m.n * Math.log10(meters);
const anchors = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 5, y: 7 }];
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

test("RSSI converts to distance with the log-distance model and stays bounded", () => {
  near(rssiToMeters(-59, model), 1, 1e-9);
  near(rssiToMeters(-79, model), 10, 1e-9);
  assert.equal(rssiToMeters(0, model), 0.1);
  assert.equal(rssiToMeters(-127, model), 60);
});

test("path loss fit recovers txPower and n from anchor links at known distances", () => {
  const truth = { txPower: -62, n: 2.6 };
  const fit = fitPathLoss([2, 4, 7, 9].map((meters) => ({ meters, rssi: rssiAt(meters, truth) })));
  assert.equal(fit.calibrated, true);
  near(fit.txPower, -62, 0.2);
  near(fit.n, 2.6, 0.02);
});

test("path loss fit keeps n when links are too similar or the slope is unphysical", () => {
  const similar = fitPathLoss([{ meters: 4, rssi: -71 }, { meters: 4.1, rssi: -72 }]);
  assert.equal(similar.n, PATH_LOSS_DEFAULTS.n);
  assert.equal(similar.calibrated, true);
  const inverted = fitPathLoss([{ meters: 2, rssi: -80 }, { meters: 5, rssi: -70 }, { meters: 9, rssi: -60 }]);
  assert.equal(inverted.n, PATH_LOSS_DEFAULTS.n); // RSSI rising with distance is noise
  assert.equal(fitPathLoss([]).calibrated, false);
});

test("locate finds the true point from exact distances", () => {
  const truth = { x: 4, y: 3 };
  const point = locate(anchors.map((a) => ({ ...a, meters: Math.hypot(a.x - truth.x, a.y - truth.y) })), { width: 10, height: 8 });
  near(point.x, 4, 0.01);
  near(point.y, 3, 0.01);
  assert.ok(point.errorM < 1);
});

test("locate returns a bounded estimate when noisy circles do not intersect", () => {
  // All distances far too short: classic trilateration has no solution here.
  const point = locate(anchors.map((a) => ({ ...a, meters: 0.5 })), { width: 10, height: 8 });
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.ok(point.x >= 0 && point.x <= 10 && point.y >= 0 && point.y <= 8);
  assert.ok(point.errorM > 1);
  // Distances that would place the basket outside the store are clamped to the floor.
  const outside = locate([{ x: 0, y: 0, meters: 30 }, { x: 1, y: 0, meters: 30 }, { x: 0, y: 1, meters: 30 }], { width: 10, height: 8 });
  assert.ok(outside.x <= 10 && outside.y <= 8);
});

test("locate with two anchors places the basket on the line between them", () => {
  const point = locate([{ x: 0, y: 0, meters: 2 }, { x: 8, y: 0, meters: 6 }], { width: 10, height: 8 });
  near(point.x, 2, 1e-9);
  near(point.y, 0, 1e-9);
  assert.equal(locate([{ x: 0, y: 0, meters: 2 }], { width: 10, height: 8 }), null);
});

test("relative placement plus alignment reproduces anchor positions from distances", () => {
  const truth = new Map([["S1", { x: 1, y: 1 }], ["S2", { x: 9, y: 1 }], ["S3", { x: 5, y: 7 }], ["S4", { x: 2, y: 6 }]]);
  const distance = (a, b) => Math.hypot(truth.get(a).x - truth.get(b).x, truth.get(a).y - truth.get(b).y);
  const relative = relativePlacement(["S1", "S2", "S3", "S4"], distance);
  // Start from a rough guess that is shifted, but has the right orientation.
  const guess = new Map([...truth].map(([id, p]) => [id, { x: p.x + 0.8, y: p.y - 0.5 }]));
  const aligned = alignTo(relative, guess);
  for (const [id, p] of truth) {
    near(aligned.get(id).x, p.x + 0.8, 0.05);
    near(aligned.get(id).y, p.y - 0.5, 0.05);
  }
  // A mirrored guess picks the mirrored solution instead of a rotated one.
  const mirrored = new Map([...truth].map(([id, p]) => [id, { x: p.x, y: 8 - p.y }]));
  const flipped = alignTo(relative, mirrored);
  for (const [id, p] of truth) near(flipped.get(id).y, 8 - p.y, 0.05);
  assert.equal(relativePlacement(["S1", "S2", "S3"], () => NaN), null);
});

test("relative placement survives distances that break the triangle inequality", () => {
  const placed = relativePlacement(["a", "b", "c"], (p, q) => ({ ab: 2, ba: 2, ac: 10, ca: 10, bc: 1, cb: 1 })[p + q]);
  for (const point of placed.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test("anchor positions come from the shelf anchor or the shelf centre, in metres", () => {
  const layout = {
    width: 360, height: 250, widthM: 12,
    zones: [
      { id: "s1", kind: "shelf", shelfId: "SHELF-01", label: "a", x: 30, y: 30, w: 60, h: 30, anchor: { x: 30, y: 30 } },
      { id: "s2", kind: "shelf", shelfId: "SHELF-02", label: "b", x: 270, y: 30, w: 60, h: 30 },
      { id: "c", kind: "cashier", label: "c", x: 10, y: 200, w: 60, h: 30 },
    ],
  };
  const positions = anchorPositions(layout);
  assert.equal(positions.size, 2);
  near(positions.get("SHELF-01").x, 1, 1e-9);
  near(positions.get("SHELF-02").x, 10, 1e-9);
  near(positions.get("SHELF-02").y, 1.5, 1e-9);
});

test("positioner calibrates from anchor links, locates a basket and smooths noise", () => {
  const layout = {
    width: 300, height: 240, widthM: 10,
    zones: [
      { id: "s1", kind: "shelf", shelfId: "SHELF-01", label: "a", x: 20, y: 20, w: 20, h: 20, anchor: { x: 30, y: 30 } },
      { id: "s2", kind: "shelf", shelfId: "SHELF-02", label: "b", x: 260, y: 20, w: 20, h: 20, anchor: { x: 270, y: 30 } },
      // Uneven distances (8, 2.2 and 7.3 m) give the fit enough spread to learn n.
      { id: "s3", kind: "shelf", shelfId: "SHELF-03", label: "c", x: 50, y: 80, w: 20, h: 20, anchor: { x: 60, y: 90 } },
    ],
  };
  const truthModel = { txPower: -60, n: 2.4 };
  const metres = anchorPositions(layout);
  const dist = (a, p) => Math.hypot(metres.get(a).x - p.x, metres.get(a).y - p.y);
  const links = [["SHELF-01", "SHELF-02"], ["SHELF-01", "SHELF-03"], ["SHELF-02", "SHELF-03"]]
    .map(([a, b]) => ({ a, b, rssi: rssiAt(dist(a, metres.get(b)), truthModel) }));
  const basket = { x: 4, y: 3 };
  const readings = (offset = 0) => ({ A: Object.fromEntries([...metres.keys()].map((id) => [id, rssiAt(dist(id, basket), truthModel) + offset])) });

  const positioner = createPositioner();
  let t = 0;
  assert.equal(positioner.update(layout, links, readings(), t), true);
  const first = positioner.snapshot(layout);
  assert.equal(first.model.calibrated, true);
  near(first.model.n, 2.4, 0.05);
  near(first.positions.A.xM, 4, 0.1);
  near(first.positions.A.yM, 3, 0.1);
  near(first.positions.A.x, 4 / (10 / 300), 3);
  assert.equal(first.positions.A.anchors, 3);
  assert.equal(first.links.length, 3);

  // Same position again: no change to publish.
  assert.equal(positioner.update(layout, links, readings(), (t += 500)), false);
  // A single noisy reading moves the smoothed point only part of the way.
  positioner.update(layout, links, readings(-6), (t += 500));
  const noisy = positioner.snapshot(layout).positions.A;
  const raw = locate([...metres].map(([id, p]) => ({ ...p, meters: rssiToMeters(rssiAt(dist(id, basket), truthModel) - 6, { txPower: -60, n: 2.4 }) })), { width: 10, height: 8 });
  assert.ok(Math.hypot(noisy.xM - 4, noisy.yM - 3) < Math.hypot(raw.x - 4, raw.y - 3));

  // One anchor only: keep the last estimate until it is stale, then drop it.
  positioner.update(layout, links, { A: { "SHELF-01": -60 } }, (t += 1000));
  assert.ok(positioner.snapshot(layout).positions.A);
  assert.equal(positioner.update(layout, links, { A: { "SHELF-01": -60 } }, (t += 6000)), true);
  assert.equal(positioner.snapshot(layout).positions.A, undefined);
});

test("auto-place proposes ESP32 positions from anchor links and keeps the store orientation", async () => {
  const { proposeAnchors } = await import("../src/positioning.mjs");
  const layout = {
    width: 300, height: 240, widthM: 10,
    zones: [
      { id: "s1", kind: "shelf", shelfId: "SHELF-01", label: "a", x: 20, y: 20, w: 20, h: 20, anchor: { x: 40, y: 40 } },
      { id: "s2", kind: "shelf", shelfId: "SHELF-02", label: "b", x: 260, y: 20, w: 20, h: 20, anchor: { x: 250, y: 40 } },
      { id: "s3", kind: "shelf", shelfId: "SHELF-03", label: "c", x: 140, y: 190, w: 20, h: 20, anchor: { x: 150, y: 200 } },
    ],
  };
  // True positions in metres differ from the rough map positions above.
  const truth = new Map([["SHELF-01", { x: 1, y: 1 }], ["SHELF-02", { x: 9, y: 1 }], ["SHELF-03", { x: 5, y: 7 }]]);
  const links = [["SHELF-01", "SHELF-02"], ["SHELF-01", "SHELF-03"], ["SHELF-02", "SHELF-03"]].map(([a, b]) => ({
    a, b, rssi: rssiAt(Math.hypot(truth.get(a).x - truth.get(b).x, truth.get(a).y - truth.get(b).y), PATH_LOSS_DEFAULTS),
  }));
  const proposal = proposeAnchors(layout, links);
  const scale = 10 / 300;
  const placed = new Map(Object.entries(proposal.anchors).map(([id, p]) => [id, { x: p.x * scale, y: p.y * scale }]));
  const d = (a, b) => Math.hypot(placed.get(a).x - placed.get(b).x, placed.get(a).y - placed.get(b).y);
  near(d("SHELF-01", "SHELF-02"), 8, 0.1);
  near(d("SHELF-02", "SHELF-03"), Math.hypot(4, 6), 0.1);
  assert.ok(placed.get("SHELF-03").y > placed.get("SHELF-01").y); // still below the top shelves, as on the map
  assert.equal(proposeAnchors(layout, links.slice(0, 1)).anchors, null);
});

test("tuning validation accepts blanks and rejects values outside physical ranges", async () => {
  const { validateTuning } = await import("../src/positioning.mjs");
  assert.deepEqual(validateTuning({}), { basketTxPower: null, n: null, alpha: null });
  assert.deepEqual(validateTuning({ basketTxPower: -63.456, n: 2.8, alpha: "" }), { basketTxPower: -63.46, n: 2.8, alpha: null });
  assert.throws(() => validateTuning({ n: 9 }), /n must be between/);
  assert.throws(() => validateTuning({ basketTxPower: "-60" }), /must be a number/);
  assert.throws(() => validateTuning([]), /JSON object/);
});

test("fixed n and a tuned basket RSSI@1m override the automatic model", () => {
  const fixed = fitPathLoss([{ meters: 4, rssi: -71 }, { meters: 8, rssi: -77 }], PATH_LOSS_DEFAULTS, { fixedN: 3 });
  assert.equal(fixed.n, 3);
  near(fixed.txPower, (-71 + 30 * Math.log10(4) + -77 + 30 * Math.log10(8)) / 2, 0.1);

  const layout = { width: 300, height: 240, widthM: 10, zones: [
    { id: "s1", kind: "shelf", shelfId: "SHELF-01", label: "a", x: 0, y: 0, w: 20, h: 20, anchor: { x: 30, y: 30 } },
    { id: "s2", kind: "shelf", shelfId: "SHELF-02", label: "b", x: 0, y: 0, w: 20, h: 20, anchor: { x: 270, y: 30 } },
  ] };
  let tuning = { basketTxPower: null, n: null, alpha: null };
  const positioner = createPositioner({ getTuning: () => tuning });
  positioner.update(layout, [], { A: { "SHELF-01": -60, "SHELF-02": -70 } }, 0);
  assert.equal(positioner.snapshot(layout).basketModel.source, "default");
  tuning = { basketTxPower: -52, n: 2.5, alpha: null };
  positioner.update(layout, [], { A: { "SHELF-01": -60, "SHELF-02": -70 } }, 500);
  const snap = positioner.snapshot(layout);
  assert.deepEqual(snap.basketModel, { txPower: -52, n: 2.5, source: "tuned" });
  assert.deepEqual(snap.tuning, tuning);
});

test("tuning store saves, reloads and resets", async () => {
  const { createTuningStore } = await import("../src/positioning.mjs");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "basketly-tuning-"));
  try {
    const path = join(directory, "tuning.json");
    const store = createTuningStore({ path, log: () => {} });
    assert.deepEqual(await store.load(), { basketTxPower: null, n: null, alpha: null });
    await store.save({ basketTxPower: -61, n: 2.4 });
    assert.deepEqual(await createTuningStore({ path }).load(), { basketTxPower: -61, n: 2.4, alpha: null });
    await assert.rejects(store.save({ n: 0 }), /n must be between/);
    assert.equal(store.get().n, 2.4);
    await store.reset();
    assert.deepEqual(await createTuningStore({ path }).load(), { basketTxPower: null, n: null, alpha: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("links between ESP32s not on the map are reported but do not calibrate", () => {
  const layout = { width: 300, height: 240, widthM: 10, zones: [
    { id: "s1", kind: "shelf", shelfId: "SHELF-01", label: "a", x: 0, y: 0, w: 20, h: 20, anchor: { x: 30, y: 30 } },
  ] };
  const positioner = createPositioner();
  positioner.update(layout, [{ a: "SHELF-01", b: "SHELF-09", rssi: -70 }, { a: "SHELF-08", b: "SHELF-09", rssi: -65 }], {}, 0);
  const snap = positioner.snapshot(layout);
  assert.equal(snap.links.length, 2);
  assert.equal(snap.links[0].mapMeters, null);
  assert.equal(snap.model.calibrated, false);
});
