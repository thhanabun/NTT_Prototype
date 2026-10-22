import type { StoreLayout, StoreZone } from "@/lib/api/types";

// Shown until the backend layout loads, and by older backends without /api/store-layout.
// Keep in step with DEFAULT_LAYOUT in src/store-layout.mjs.
export const DEFAULT_STORE_LAYOUT: StoreLayout = {
  width: 360,
  height: 250,
  widthM: 12,
  zones: [
    { id: "shelf-01", kind: "shelf", shelfId: "SHELF-01", label: "เครื่องดื่ม", detail: "Coke · Water", x: 28, y: 30, w: 132, h: 32 },
    { id: "shelf-02", kind: "shelf", shelfId: "SHELF-02", label: "ขนม", detail: "Snacks", x: 200, y: 30, w: 132, h: 32 },
    { id: "shelf-03", kind: "shelf", shelfId: "SHELF-03", label: "โซนพิเศษ", detail: "High-value", x: 200, y: 122, w: 132, h: 32 },
    { id: "cashier", kind: "cashier", label: "แคชเชียร์", x: 28, y: 186, w: 112, h: 38 },
    { id: "entrance", kind: "entrance", label: "ทางเข้า", x: 232, y: 222, w: 80, h: 20 },
  ],
  updatedAt: null,
};

export const LAYOUT_MIN_SIZE = 12;
export const LAYOUT_MAX_ZONES = 24;

export function shelfZone(layout: StoreLayout, shelfId: string | null | undefined): StoreZone | undefined {
  return shelfId ? layout.zones.find((zone) => zone.kind === "shelf" && zone.shelfId === shelfId) : undefined;
}

// Where a basket near a shelf is drawn: just below it, or above it when the shelf sits at the bottom edge.
export function standPoint(layout: StoreLayout, zone: StoreZone, offset = 0) {
  const below = zone.y + zone.h + 24;
  return { x: zone.x + zone.w / 2 + offset, y: below + 10 <= layout.height ? below : Math.max(24, zone.y - 10) };
}

// Where a shelf's ESP32 sits (map units).
export function anchorPoint(zone: StoreZone) {
  return zone.anchor ?? { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
}

export function metersPerUnit(layout: StoreLayout) {
  return (layout.widthM && layout.widthM > 0 ? layout.widthM : 12) / layout.width;
}

export function shortLabel(label: string, width: number, reserved: number) {
  const max = Math.max(2, Math.floor((width - reserved) / 7));
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}
