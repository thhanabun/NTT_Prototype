// Store floor plan used by the shopper map. Staff edit it in Admin; it is saved as
// a small JSON file next to the demo state. It is display data only: it never
// changes carts, presence zones or checkout.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const LAYOUT_LIMITS = Object.freeze({
  maxZones: 24, minSize: 12, minCanvas: 200, maxCanvas: 1200, labelMax: 40, detailMax: 40,
});
const ZONE_KINDS = new Set(["shelf", "cashier", "entrance"]);
const ZONE_ID = /^[a-z0-9-]{1,32}$/;
const SHELF_ID = /^[A-Z0-9-]{1,32}$/;

export const DEFAULT_LAYOUT = Object.freeze({
  width: 360,
  height: 250,
  zones: [
    { id: "shelf-01", kind: "shelf", shelfId: "SHELF-01", label: "เครื่องดื่ม", detail: "Coke · Water", x: 28, y: 30, w: 132, h: 32 },
    { id: "shelf-02", kind: "shelf", shelfId: "SHELF-02", label: "ขนม", detail: "Snacks", x: 200, y: 30, w: 132, h: 32 },
    { id: "shelf-03", kind: "shelf", shelfId: "SHELF-03", label: "โซนพิเศษ", detail: "High-value", x: 200, y: 122, w: 132, h: 32 },
    { id: "cashier", kind: "cashier", label: "แคชเชียร์", x: 28, y: 186, w: 112, h: 38 },
    { id: "entrance", kind: "entrance", label: "ทางเข้า", x: 232, y: 222, w: 80, h: 20 },
  ],
});

const defaultLayout = () => ({ ...structuredClone(DEFAULT_LAYOUT), updatedAt: null });
const round = (value) => Math.round(value * 10) / 10;

function text(value, max, field, { required }) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`${field} is required`);
  if (result.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return result;
}

function number(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a number`);
  return round(value);
}

// Returns a clean copy of a layout, or throws with a message staff can act on.
export function validateLayout(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Layout must be a JSON object");
  const width = number(input.width, "width");
  const height = number(input.height, "height");
  for (const [name, value] of [["width", width], ["height", height]]) {
    if (value < LAYOUT_LIMITS.minCanvas || value > LAYOUT_LIMITS.maxCanvas) {
      throw new Error(`${name} must be between ${LAYOUT_LIMITS.minCanvas} and ${LAYOUT_LIMITS.maxCanvas}`);
    }
  }
  if (!Array.isArray(input.zones) || input.zones.length === 0) throw new Error("Layout needs at least one zone");
  if (input.zones.length > LAYOUT_LIMITS.maxZones) throw new Error(`Layout can have at most ${LAYOUT_LIMITS.maxZones} zones`);

  const ids = new Set();
  const shelfIds = new Set();
  const zones = input.zones.map((zone, index) => {
    const where = `Zone ${index + 1}`;
    if (!zone || typeof zone !== "object") throw new Error(`${where} must be an object`);
    const id = String(zone.id ?? "");
    if (!ZONE_ID.test(id)) throw new Error(`${where} needs an id of lowercase letters, digits or dashes`);
    if (ids.has(id)) throw new Error(`${where} repeats id ${id}`);
    ids.add(id);
    if (!ZONE_KINDS.has(zone.kind)) throw new Error(`${where} kind must be shelf, cashier or entrance`);

    const clean = {
      id,
      kind: zone.kind,
      label: text(zone.label, LAYOUT_LIMITS.labelMax, `${where} label`, { required: true }),
      x: number(zone.x, `${where} x`),
      y: number(zone.y, `${where} y`),
      w: number(zone.w, `${where} width`),
      h: number(zone.h, `${where} height`),
    };
    const detail = text(zone.detail, LAYOUT_LIMITS.detailMax, `${where} detail`, { required: false });
    if (detail) clean.detail = detail;
    if (clean.kind === "shelf") {
      const shelfId = String(zone.shelfId ?? "").trim().toUpperCase();
      if (!SHELF_ID.test(shelfId)) throw new Error(`${where} needs a Shelf ID like SHELF-01`);
      if (shelfIds.has(shelfId)) throw new Error(`${shelfId} is used by more than one shelf`);
      shelfIds.add(shelfId);
      clean.shelfId = shelfId;
    }
    if (clean.w < LAYOUT_LIMITS.minSize || clean.h < LAYOUT_LIMITS.minSize) {
      throw new Error(`${where} must be at least ${LAYOUT_LIMITS.minSize} units wide and tall`);
    }
    if (clean.x < 0 || clean.y < 0 || clean.x + clean.w > width || clean.y + clean.h > height) {
      throw new Error(`${where} (${clean.label}) is outside the floor`);
    }
    return clean;
  });
  return { width, height, zones };
}

export function createLayoutStore({ path, log = console.error }) {
  let current = defaultLayout();

  return {
    async load() {
      try {
        const saved = JSON.parse(await readFile(path, "utf8"));
        current = { ...validateLayout(saved), updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : null };
      } catch (error) {
        if (error.code !== "ENOENT") log("Store layout file ignored: " + error.message);
        current = defaultLayout();
      }
      return current;
    },
    get() {
      return current;
    },
    async save(input) {
      const next = { ...validateLayout(input), updatedAt: new Date().toISOString() };
      await mkdir(dirname(path), { recursive: true });
      const temporary = path + ".tmp";
      await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
      await rename(temporary, path);
      current = next;
      return current;
    },
    async reset() {
      await rm(path, { force: true });
      current = defaultLayout();
      return current;
    },
  };
}
