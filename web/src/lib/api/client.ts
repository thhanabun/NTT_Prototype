import type {
  ApiState,
  BasketCase,
  BasketId,
  Order,
  ProcessShelfEventResult,
  Session,
  ShelfEventInput,
  StatsPlan,
  StatsResponse,
} from "@/lib/api/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  if (body === null || typeof body !== "object") {
    throw new ApiError("The server returned an invalid JSON response.", response.status);
  }

  return body as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let selectedBasket = "A";
  if (process.env.NEXT_PUBLIC_CLOUD_MODE === "true" && typeof window !== "undefined") {
    selectedBasket = new URLSearchParams(window.location.search).get("basket") || "";
    if (!selectedBasket) { try { selectedBasket = localStorage.getItem("basketly-basket") || "A"; } catch { selectedBasket = "A"; } }
  }
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
    headers: {
      ...(process.env.NEXT_PUBLIC_CLOUD_MODE === "true" ? { "x-basket-id": selectedBasket } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  return readResponse<T>(response);
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function getState(signal?: AbortSignal): Promise<ApiState> {
  return request<ApiState>("/api/state", {signal});
}

export function createRealtimeTicket(): Promise<{ ticket: string; connectionExpiresAt?: number }> {
  return post("/api/realtime-ticket", {});
}

export function releaseBasketSession(basketId: BasketId): Promise<{ ok: true }> {
  return post("/api/sessions", { basketId, action: "RELEASE" });
}

export function startSession(basketId: BasketId): Promise<{ session: Session }> {
  if (process.env.NEXT_PUBLIC_CLOUD_MODE !== "true") return post("/api/sessions", { basketId });
  let pairingAttempt = crypto.randomUUID();
  try { const key = "basketly-pairing-" + basketId; pairingAttempt = sessionStorage.getItem(key) || pairingAttempt; sessionStorage.setItem(key, pairingAttempt); } catch { /* QR pairing remains available when session storage is blocked. */ }
  return post("/api/sessions", { basketId, pairingCode: new URLSearchParams(window.location.search).get("code"), pairingAttempt });
}

export function confirmCustomerCase(
  caseId: string,
  answer: "YES" | "NO",
): Promise<{ case: BasketCase }> {
  return post(`/api/cases/${encodeURIComponent(caseId)}/customer`, { answer });
}

export function decideStaffCase(
  caseId: string,
  decision: "APPROVE" | "REJECT",
  basketId?: BasketId,
): Promise<{ case: BasketCase }> {
  return post(`/api/cases/${encodeURIComponent(caseId)}/staff`, { decision, basketId });
}

export function checkout(basketId: BasketId): Promise<{ order: Order }> {
  return post("/api/checkout", { basketId });
}

export function submitShelfEvent(event: ShelfEventInput): Promise<ProcessShelfEventResult> {
  // The backend permits 30 seconds for real model inference before staff fallback.
  return request("/api/events", { method: "POST", body: JSON.stringify(event), signal: AbortSignal.timeout(35_000) });
}

export function resetDemo(): Promise<{ ok: true }> {
  return post("/api/reset", {});
}

export function queryStatistics(message: string, source: "orders" | "demo", previousPlan?: StatsPlan): Promise<StatsResponse> {
  return request("/api/stats/query", { method: "POST", body: JSON.stringify({ message, source, previousPlan }), signal: AbortSignal.timeout(35_000) });
}
