import type { Basket, BasketId, CartLine, Order, Product } from "@/lib/api/types";

// Phase 3 fixtures only. Phase 4 will supply authoritative data from the API.
export const sampleProducts: Product[] = [
  { sku: "COKE", name: "Coca-Cola", price: 25, color: "#e44343" },
  { sku: "WATER", name: "Mineral water", price: 15, color: "#2789cb" },
];

export const sampleLines: CartLine[] = sampleProducts.map((product) => ({
  sku: product.sku,
  name: product.name,
  price: product.price,
  quantity: 1,
  subtotal: product.price,
}));

export const previewStates = [
  { id: "connect", label: "Connect basket" },
  { id: "empty", label: "Empty cart" },
  { id: "cart", label: "Confirmed cart" },
  { id: "confirm", label: "Confirm pick" },
  { id: "return", label: "Confirm return" },
  { id: "multiple", label: "Multiple cases" },
  { id: "staff", label: "Staff review" },
  { id: "loading", label: "Loading" },
  { id: "submitting", label: "Submitting" },
  { id: "error", label: "Load error" },
  { id: "action-error", label: "Action error" },
  { id: "offline", label: "Disconnected" },
  { id: "receipt", label: "Receipt" },
] as const;

export type PreviewState = (typeof previewStates)[number]["id"] | "remaining" | "double-cart" | "returned" | "staff-pending";

export function sampleBasket(basketId: BasketId, state: PreviewState): Basket {
  const inactive = state === "connect" || state === "receipt";
  const pending = ["confirm", "return", "multiple", "remaining", "staff", "staff-pending"].includes(state);
  const lines = state === "double-cart"
    ? [{ ...sampleLines[0], quantity: 2, subtotal: 50 }, sampleLines[1]]
    : ["cart", "return", "remaining", "staff", "submitting", "offline", "action-error"].includes(state)
    ? sampleLines
    : state === "confirm" || state === "multiple" || state === "returned" || state === "staff-pending"
      ? [sampleLines[1]]
      : [];

  return {
    basketId,
    session: inactive ? null : {
      sessionId: `SES-DEMO-${basketId}`,
      basketId,
      status: "ACTIVE",
      startedAt: "2026-10-11T03:24:15.000Z",
    },
    lines,
    total: lines.reduce((total, line) => total + line.subtotal, 0),
    payable: !inactive && !pending,
    unresolvedCaseCount: state === "multiple" ? 2 : pending ? 1 : 0,
  };
}

export function sampleReceipt(basketId: BasketId, lines: CartLine[] = sampleLines): Order {
  return {
    orderId: "MOCK-DEMO-001",
    basketId,
    lines: lines.map(({ price, ...line }) => ({ ...line, unitPrice: price })),
    total: lines.reduce((total, line) => total + line.subtotal, 0),
    createdAt: "2026-10-11T03:30:00.000Z",
    paymentMode: "MOCK",
  };
}
