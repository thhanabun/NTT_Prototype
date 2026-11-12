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
    const x = finite(shape.x, -width, width, "shape position"), y = finite(shape.y, -height, height, "shape position");
    const w = finite(shape.w, 0.5, width, "shape size"), h = finite(shape.h, 0.5, height, "shape size");
    const angle = shape.angle === undefined ? 0 : finite(shape.angle, -180, 180, "shape angle");
    const result = { id: shape.id, kind: shape.kind, label, x, y, w, h, angle };
    if (shapeCorners(result).some(p => p.x < -1e-6 || p.y < -1e-6 || p.x > width + 1e-6 || p.y > height + 1e-6)) throw new Error(`“${label}” is outside the map`);
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

// A shape is the box x,y,w,h turned by `angle` degrees around its centre.
const toLocal = (point, shape) => {
  const a = -(shape.angle || 0) * Math.PI / 180, dx = point.x - (shape.x + shape.w / 2), dy = point.y - (shape.y + shape.h / 2);
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
};

/** Corners in order: top-left, top-right, bottom-right, bottom-left of the unrotated box, then turned. */
export function shapeCorners(shape) {
  const a = (shape.angle || 0) * Math.PI / 180, cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = sx * shape.w / 2, dy = sy * shape.h / 2;
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  });
}

/** Distance from a point to the shape's edge in map units; 0 inside. */
export function distanceToShape(point, shape) {
  const p = toLocal(point, shape);
  return Math.hypot(Math.max(Math.abs(p.x) - shape.w / 2, 0), Math.max(Math.abs(p.y) - shape.h / 2, 0));
}

export const shelfShape = (map, shelfId) => map.shapes.find(item => item.kind === "shelf" && item.shelfId === shelfId) ?? null;

/** "At the shelf" means within SHELF_ZONE_M of the shelf box, at any angle. Returns metres, or null when outside. */
export function shelfZoneDistance(map, shelfId, point) {
  const shape = shelfShape(map, shelfId);
  if (!shape) return null;
  const metres = distanceToShape(point, shape) * metresPerUnit(map);
  return metres <= SHELF_ZONE_M ? metres : null;
}

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
