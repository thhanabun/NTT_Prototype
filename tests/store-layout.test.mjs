import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LAYOUT, createLayoutStore, validateLayout } from "../src/store-layout.mjs";

const copy = () => structuredClone(DEFAULT_LAYOUT);

test("default layout is valid and keeps all fields", () => {
  const layout = validateLayout(copy());
  assert.equal(layout.zones.length, DEFAULT_LAYOUT.zones.length);
  assert.deepEqual(layout.zones[0], DEFAULT_LAYOUT.zones[0]);
});

test("validation trims text, uppercases shelf IDs and rounds coordinates", () => {
  const layout = copy();
  layout.zones[0] = { ...layout.zones[0], label: "  เครื่องดื่มเย็น  ", shelfId: "shelf-09", x: 10.04, detail: "" };
  const clean = validateLayout(layout).zones[0];
  assert.equal(clean.label, "เครื่องดื่มเย็น");
  assert.equal(clean.shelfId, "SHELF-09");
  assert.equal(clean.x, 10);
  assert.equal("detail" in clean, false);
});

test("validation rejects layouts staff could not have meant", () => {
  const cases = [
    [(l) => { l.zones[0].x = 300; }, /outside the floor/],
    [(l) => { l.zones[1].shelfId = "SHELF-01"; }, /more than one shelf/],
    [(l) => { l.zones[1].id = l.zones[0].id; }, /repeats id/],
    [(l) => { l.zones[0].kind = "door"; }, /kind/],
    [(l) => { l.zones[0].label = "  "; }, /label is required/],
    [(l) => { l.zones[0].shelfId = ""; }, /Shelf ID/],
    [(l) => { l.zones[0].w = 4; }, /at least 12/],
    [(l) => { l.zones[0].y = "10"; }, /must be a number/],
    [(l) => { l.zones = []; }, /at least one zone/],
    [(l) => { l.zones = Array.from({ length: 25 }, (_, i) => ({ ...l.zones[3], id: `z-${i}` })); }, /at most 24/],
    [(l) => { l.width = 50; }, /width must be between/],
  ];
  for (const [change, message] of cases) {
    const layout = copy();
    change(layout);
    assert.throws(() => validateLayout(layout), message);
  }
  assert.throws(() => validateLayout([]), /JSON object/);
});

test("layout store saves, reloads and resets to the default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basketly-layout-"));
  try {
    const path = join(directory, "nested", "store-layout.json");
    const store = createLayoutStore({ path, log: () => {} });
    assert.equal((await store.load()).updatedAt, null);

    const edited = copy();
    edited.zones[1].label = "ขนมขบเคี้ยว";
    const saved = await store.save(edited);
    assert.equal(saved.zones[1].label, "ขนมขบเคี้ยว");
    assert.ok(saved.updatedAt);
    assert.equal(JSON.parse(await readFile(path, "utf8")).zones[1].label, "ขนมขบเคี้ยว");

    const reopened = createLayoutStore({ path, log: () => {} });
    assert.equal((await reopened.load()).zones[1].label, "ขนมขบเคี้ยว");

    await assert.rejects(store.save({ ...edited, zones: [] }), /at least one zone/);
    assert.equal(store.get().zones[1].label, "ขนมขบเคี้ยว"); // a rejected save keeps the old layout

    const reset = await store.reset();
    assert.equal(reset.zones[1].label, DEFAULT_LAYOUT.zones[1].label);
    assert.equal((await createLayoutStore({ path, log: () => {} }).load()).updatedAt, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a corrupt layout file falls back to the default instead of crashing the server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basketly-layout-"));
  try {
    const path = join(directory, "store-layout.json");
    await writeFile(path, "{not json", "utf8");
    const logs = [];
    const layout = await createLayoutStore({ path, log: (line) => logs.push(line) }).load();
    assert.equal(layout.zones.length, DEFAULT_LAYOUT.zones.length);
    assert.equal(logs.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("layouts carry the floor width in metres and optional ESP32 anchor points", () => {
  const legacy = copy();
  delete legacy.widthM;
  assert.equal(validateLayout(legacy).widthM, DEFAULT_LAYOUT.widthM); // saved before positioning existed

  const layout = copy();
  layout.widthM = 15.25;
  layout.zones[0].anchor = { x: 40.04, y: 35 };
  layout.zones[3].anchor = { x: 1, y: 1 }; // cashier: ignored, only shelves host ESP32s
  const clean = validateLayout(layout);
  assert.equal(clean.widthM, 15.3);
  assert.deepEqual(clean.zones[0].anchor, { x: 40, y: 35 });
  assert.equal("anchor" in clean.zones[3], false);

  for (const [change, message] of [
    [(l) => { l.widthM = 0.5; }, /Store width/],
    [(l) => { l.zones[0].anchor = { x: 400, y: 10 }; }, /ESP32 position is outside/],
    [(l) => { l.zones[0].anchor = { x: "1", y: 10 }; }, /ESP32 x must be a number/],
  ]) {
    const bad = copy();
    change(bad);
    assert.throws(() => validateLayout(bad), message);
  }
});
