import type { ApiState, Shelf } from "@/lib/api/types";

export const SHELF_OPTIONS = [
  { shelfId: "SHELF-01", label: "Shelf 1", enabled: true },
  { shelfId: "SHELF-02", label: "Shelf 2", enabled: true },
  { shelfId: "SHELF-03", label: "Shelf 3", enabled: true },
];

// Shelf 2 uses the canonical SKU assigned by the backend's shelf mapping.
export const SHELF_PRODUCTS = [
  { shelfId: "SHELF-01", sku: "COKE", name: "Cola", art: "cola" },
  { shelfId: "SHELF-02", sku: "SPRITE_PLUS_TEA", name: "Sprite Plus Tea", art: "sprite-tea" },
  { shelfId: "SHELF-03", sku: "COKE", name: "Fanta floral bloom", art: "blue-fanta" },
] as const;

export function getShelfProduct(shelfId?: string) {
  return SHELF_PRODUCTS.find(product => product.shelfId === shelfId);
}

export function getShelves(state: ApiState | null): Shelf[] {
  return SHELF_OPTIONS.map(option => {
    const reported = state?.shelves?.find(shelf => shelf.shelfId === option.shelfId)
      ?? (state?.shelf.shelfId === option.shelfId ? state.shelf : undefined);
    return {
      lastSeenAt: null, lastEventId: null, fsmState: "IDLE", rssi: { A: null, B: null },
      ...reported, ...option,
      status: option.enabled ? reported?.device?.status ?? "UNKNOWN" : "INACTIVE",
    };
  });
}
