import type {
  ApiState,
  AutoPlaceProposal,
  BasketCase,
  BasketId,
  Order,
  PositioningTuning,
  PresenceSnapshot,
  ProcessShelfEventResult,
  Session,
  ShelfEventInput,
  StoreLayout,
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
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
    headers: {
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

export function getPresence(signal?: AbortSignal): Promise<PresenceSnapshot> {
  return request<PresenceSnapshot>("/api/presence", {signal});
}

export function getStoreLayout(signal?: AbortSignal): Promise<StoreLayout> {
  return request<StoreLayout>("/api/store-layout", {signal});
}

export function saveStoreLayout(layout: StoreLayout): Promise<StoreLayout> {
  return request<StoreLayout>("/api/store-layout", { method: "PUT", body: JSON.stringify(layout) });
}

export function saveTuning(tuning: PositioningTuning): Promise<PositioningTuning> {
  return request<PositioningTuning>("/api/positioning/tuning", { method: "PUT", body: JSON.stringify(tuning) });
}

export function resetTuning(): Promise<PositioningTuning> {
  return request<PositioningTuning>("/api/positioning/tuning", { method: "DELETE" });
}

export function getAutoPlace(): Promise<AutoPlaceProposal> {
  return request<AutoPlaceProposal>("/api/positioning/auto-place");
}

export function resetStoreLayout(): Promise<StoreLayout> {
  return request<StoreLayout>("/api/store-layout", { method: "DELETE" });
}

export function startSession(basketId: BasketId): Promise<{ session: Session }> {
  return post("/api/sessions", { basketId });
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
