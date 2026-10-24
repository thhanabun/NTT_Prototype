const SPRITE = { sku: "SPRITE_PLUS_TEA", name: "Sprite Plus Tea", price: 15, color: "#79a83b" };

export function productCatalog(products) {
  return {
    ...products,
    COKE: { ...products.COKE, name: "Cola" },
    SPRITE_PLUS_TEA: { ...SPRITE, ...products.SPRITE_PLUS_TEA },
  };
}

export function shelfSku(shelfId, laneSku) {
  if (shelfId === "SHELF-01") return "COKE";
  return shelfId === "SHELF-02" ? "SPRITE_PLUS_TEA" : laneSku;
}
