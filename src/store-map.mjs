import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { SHELF_IDS } from "./shelves.mjs";

// Map units are arbitrary until staff type one real length (metresPerUnit).
export const ASSUMED_WIDTH_M = 10;
export const SHELF_ZONE_M = 1;
const MAX_SHAPES = 24;
const MAX_CAMERAS = 8;
export const CAMERA_ID = /^CAM-[A-Z0-9-]{1,32}$/;

export const DEFAULT_STORE_MAP = Object.freeze({
  version: 1, width: 100, height: 70, metresPerUnit: null,
  shapes: [
    { id: "shelf-1", kind: "shelf", shelfId: "SHELF-01", label: "Shelf 1", x: 10, y: 10, w: 20, h: 8 },
    { id: "shelf-2", kind: "shelf", shelfId: "SHELF-02", label: "Shelf 2", x: 40, y: 10, w: 20, h: 8 },
    { id: "shelf-3", kind: "shelf", shelfId: "SHELF-03", label: "Shelf 3", x: 70, y: 10, w: 20, h: 8 },
    { id: "entrance", kind: "area", label: "Entrance", x: 40, y: 62, w: 20, h: 8 },
  ],
  cameras: {},
});

const finite = (value, min, max, label) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  return value;
};

export function validateCameraMapping(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid camera mapping");
  const width = finite(input.width, 32, 4096, "camera width"), height = finite(input.height, 32, 4096, "camera height");
  if (!Array.isArray(input.h) || input.h.length !== 9 || !input.h.every(Number.isFinite)) throw new Error("Camera mapping must be 9 numbers");
  return { width: Math.round(width), height: Math.round(height), h: input.h.map(Number), updatedAt: new Date().toISOString() };
}

export function validateStoreMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Store map must be an object");
  const width = finite(input.width, 10, 1000, "map width"), height = finite(input.height, 10, 1000, "map height");
  const metresPerUnit = input.metresPerUnit === null || input.metresPerUnit === undefined ? null : finite(input.metresPerUnit, 0.001, 100, "scale");
  if (!Array.isArray(input.shapes) || input.shapes.length > MAX_SHAPES) throw new Error(`A map has at most ${MAX_SHAPES} shapes`);
  const ids = new Set(), shelves = new Set();
  const shapes = input.shapes.map(shape => {
    if (!shape || typeof shape !== "object") throw new Error("Invalid shape");
    if (typeof shape.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(shape.id) || ids.has(shape.id)) throw new Error("Shape IDs must be unique lowercase IDs");
    ids.add(shape.id);
    if (!["shelf", "area"].includes(shape.kind)) throw new Error("Shape kind must be shelf or area");
    const label = String(shape.label ?? "").trim().slice(0, 40);
    if (!label) throw new Error("Every shape needs a name");
    const x = finite(shape.x, 0, width, "shape position"), y = finite(shape.y, 0, height, "shape position");
    const w = finite(shape.w, 0.5, width - x, "shape size"), h = finite(shape.h, 0.5, height - y, "shape size");
    const result = { id: shape.id, kind: shape.kind, label, x, y, w, h };
    if (shape.kind === "shelf") {
      if (!SHELF_IDS.includes(shape.shelfId) || shelves.has(shape.shelfId)) throw new Error("Each shelf shape needs its own shelf ID: " + SHELF_IDS.join(", "));
      shelves.add(shape.shelfId);
      result.shelfId = shape.shelfId;
    }
    return result;
  });
  const cameras = {};
  const entries = Object.entries(input.cameras ?? {});
  if (entries.length > MAX_CAMERAS) throw new Error(`At most ${MAX_CAMERAS} mapped cameras`);
  for (const [id, mapping] of entries) {
    if (!CAMERA_ID.test(id)) throw new Error("Invalid camera ID");
    cameras[id] = { ...validateCameraMapping(mapping), updatedAt: typeof mapping.updatedAt === "string" ? mapping.updatedAt : new Date().toISOString() };
  }
  return { version: 1, width, height, metresPerUnit, shapes, cameras };
}

export function metresPerUnit(map) {
  return map.metresPerUnit ?? ASSUMED_WIDTH_M / map.width;
}

// Where a shopper counts as "at the shelf": the shelf box grown by SHELF_ZONE_M on every side.
export function shelfZone(map, shelfId) {
  const shape = map.shapes.find(item => item.kind === "shelf" && item.shelfId === shelfId);
  if (!shape) return null;
  const grow = SHELF_ZONE_M / metresPerUnit(map);
  return { x: shape.x - grow, y: shape.y - grow, w: shape.w + 2 * grow, h: shape.h + 2 * grow };
}

export const inRect = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

export function createStoreMapFile(path) {
  let current = structuredClone(DEFAULT_STORE_MAP);
  let queue = Promise.resolve();
  async function save(next) {
    if (!path) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path + ".tmp", JSON.stringify(next, null, 2), "utf8");
    await rename(path + ".tmp", path);
  }
  // Writes are queued so a camera save and a map save cannot overwrite each other.
  const update = mutate => (queue = queue.catch(() => {}).then(async () => {
    const next = validateStoreMap(mutate(structuredClone(current)));
    await save(next);
    current = next;
    return current;
  }));
  return {
    async load() {
      if (!path) return current;
      try { current = validateStoreMap(JSON.parse(await readFile(path, "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw new Error("Store map file is invalid: " + error.message); }
      return current;
    },
    get: () => current,
    saveLayout: input => update(draft => ({ ...validateStoreMap({ ...input, cameras: {} }), cameras: draft.cameras })),
    saveCamera: (cameraId, mapping) => update(draft => {
      if (!CAMERA_ID.test(cameraId)) throw new Error("Invalid camera ID");
      if (mapping === null) delete draft.cameras[cameraId];
      else draft.cameras[cameraId] = validateCameraMapping(mapping);
      return draft;
    }),
  };
}
