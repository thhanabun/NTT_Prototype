import type {
  ApiState,
  BasketCase,
  BasketId,
  Order,
  ProcessShelfEventResult,
  Session,
  ShelfEventInput,
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
    signal: AbortSignal.timeout(12_000),
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

export function getState(): Promise<ApiState> {
  return request<ApiState>("/api/state");
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
  return post("/api/events", event);
}

export function resetDemo(): Promise<{ ok: true }> {
  return post("/api/reset", {});
}

export function subscribeToState(
  onState: (state: ApiState) => void,
  onError?: (error: Error) => void,
): () => void {
  const stream = new EventSource("/api/stream");

  stream.addEventListener("state", (event) => {
    try {
      onState(JSON.parse((event as MessageEvent<string>).data) as ApiState);
    } catch {
      onError?.(new Error("The live state update could not be read."));
    }
  });
  stream.onerror = () => onError?.(new Error("The live update connection was interrupted."));

  return () => stream.close();
}
