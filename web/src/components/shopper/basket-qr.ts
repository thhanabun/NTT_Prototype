import type { BasketId } from "@/lib/api/types";

export function parseBasketQr(value: string): BasketId | null {
  try {
    const basket = new URL(value, "https://basketly.invalid").searchParams.get("basket");
    return basket === "A" || basket === "B" ? basket : null;
  } catch {
    return null;
  }
}
