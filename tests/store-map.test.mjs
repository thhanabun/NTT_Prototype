import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STORE_MAP, createStoreMapFile, metresPerUnit, shapeCorners, shelfZoneDistance, validateStoreMap } from "../src/store-map.mjs";

const H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test("store map rejects bad shapes and assumes 10 m width until measured", () => {
  const map = validateStoreMap(DEFAULT_STORE_MAP);
  assert.equal(metresPerUnit(map), 0.1);
  assert.equal(metresPerUnit({ ...map, metresPerUnit: 0.05 }), 0.05);
  const shelf = map.shapes[0];
  assert.throws(() => validateStoreMap({ ...map, shapes: [shelf, { ...shelf, id: "other" }] }), /own shelf ID/);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...shelf, shelfId: "SHELF-99" }] }), /own shelf ID/);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...shelf, x: 95, w: 20 }] }), /outside the map/);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...shelf, label: " " }] }), /needs a name/);
  assert.throws(() => validateStoreMap({ ...map, cameras: { "cam 1": { width: 640, height: 360, h: H } } }), /camera ID/);
});

test("shelf zone is within 1 m of the shelf box, also when the shelf is turned", () => {
  const map = validateStoreMap(DEFAULT_STORE_MAP); // Shelf 1 box x 10–30, y 10–18; 1 m = 10 units
  assert.equal(shelfZoneDistance(map, "SHELF-01", { x: 20, y: 14 }), 0);
  assert.equal(shelfZoneDistance(map, "SHELF-01", { x: 20, y: 26 }).toFixed(2), "0.80");
  assert.equal(shelfZoneDistance(map, "SHELF-01", { x: 20, y: 29 }), null);
  assert.equal(shelfZoneDistance(map, "SHELF-99", { x: 20, y: 14 }), null);
  const turned = validateStoreMap({ ...map, shapes: [{ ...map.shapes[0], angle: 90 }] }); // now 8 wide, 20 tall, centre (20,14)
  assert.equal(shelfZoneDistance(turned, "SHELF-01", { x: 20, y: 26 }).toFixed(2), "0.20");
  assert.equal(shelfZoneDistance(turned, "SHELF-01", { x: 30, y: 14 }).toFixed(2), "0.60");
  const c = shapeCorners({ x: 0, y: 0, w: 4, h: 2, angle: 90 });
  assert.deepEqual(c.map(p => [Math.round(p.x), Math.round(p.y)]), [[3, -1], [3, 3], [1, 3], [1, -1]]);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...map.shapes[0], x: 90, angle: 45 }] }), /outside the map/);
});

test("layout and camera saves are persisted and do not overwrite each other", async () => {
  const directory = await mkdtemp(join(tmpdir(), "store-map-"));
  try {
    const path = join(directory, "store-map.json");
    const file = createStoreMapFile(path);
    await file.load();
    await Promise.all([
      file.saveCamera("CAM-01", { width: 640, height: 360, h: H }),
      file.saveLayout({ ...DEFAULT_STORE_MAP, metresPerUnit: 0.08 }),
    ]);
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.equal(saved.metresPerUnit, 0.08);
    assert.deepEqual(saved.cameras["CAM-01"].h, H);
    await file.saveCamera("CAM-01", null);
    const reloaded = createStoreMapFile(path);
    assert.deepEqual((await reloaded.load()).cameras, {});
    await assert.rejects(file.saveLayout({ ...DEFAULT_STORE_MAP, width: 5 }), /map width/);
    assert.equal(file.get().width, 100);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
