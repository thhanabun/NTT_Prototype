import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STORE_MAP, createStoreMapFile, metresPerUnit, shelfZone, validateStoreMap } from "../src/store-map.mjs";

const H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test("store map rejects bad shapes and assumes 10 m width until measured", () => {
  const map = validateStoreMap(DEFAULT_STORE_MAP);
  assert.equal(metresPerUnit(map), 0.1);
  assert.equal(metresPerUnit({ ...map, metresPerUnit: 0.05 }), 0.05);
  const shelf = map.shapes[0];
  assert.throws(() => validateStoreMap({ ...map, shapes: [shelf, { ...shelf, id: "other" }] }), /own shelf ID/);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...shelf, shelfId: "SHELF-99" }] }), /own shelf ID/);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...shelf, x: 95, w: 20 }] }), /shape size/);
  assert.throws(() => validateStoreMap({ ...map, shapes: [{ ...shelf, label: " " }] }), /needs a name/);
  assert.throws(() => validateStoreMap({ ...map, cameras: { "cam 1": { width: 640, height: 360, h: H } } }), /camera ID/);
});

test("shelf zone grows the shelf box by 1 m in map units", () => {
  const map = validateStoreMap(DEFAULT_STORE_MAP);
  assert.deepEqual(shelfZone(map, "SHELF-01"), { x: 0, y: 0, w: 40, h: 28 });
  assert.equal(shelfZone(map, "SHELF-99"), null);
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
