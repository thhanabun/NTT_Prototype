export interface ShopperSource {
  id: string;
  kind: "guide" | "catalog" | "basket" | "cases";
  title: string;
  excerpt: string;
  data: {
    text?: string;
    version?: string;
    products?: { sku: string; name: string; price: number; currency: string }[];
    shelves?: { shelfId: string; sku: string }[];
    basketId?: "A" | "B";
    lines?: { sku: string; name: string; price: number; quantity: number; subtotal: number }[];
    total?: number;
    pendingCount?: number;
    canCheckout?: boolean;
    items?: { caseId: string; sku: string; eventType: string; status: string; requiresStaff: boolean }[];
  };
}

export interface ShopperAgentResponse {
  queryId: string;
  answer: string;
  kind: "answer" | "blocked" | "unsupported";
  mode: "model" | "demo";
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  modelCalls: number;
  sources: ShopperSource[];
}
