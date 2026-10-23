export type BasketId = "A" | "B";

export interface StatsPlan {
  tool: "query_daily_sales" | "query_top_products";
  metric: "revenue" | "quantity";
  chart: "bar" | "line" | "table";
  startDate: string;
  endDate: string;
  limit: number;
  timeZone: "Asia/Bangkok";
}

export interface StatsResponse {
  queryId: string;
  generatedAt: string;
  source: "DEMO" | "MOCK_CHECKOUT_ORDERS";
  plan: StatsPlan;
  model: { name: string; requestDurationMs: number; selections: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }> };
  result: {
    rows: { key: string; label: string; value: number; revenue: number; quantity: number; orderCount: number }[];
    totals: { revenue: number; quantity: number; orderCount: number };
    availableGroups: number;
    unit: "THB" | "units";
    empty: boolean;
  };
}
export type Sku = "COKE" | "WATER";
export type EventType = "PICK" | "PUT_BACK";
export type CaseStatus = "WAITING_CUSTOMER" | "OPEN_STAFF" | "CLOSED";
export type CaseType =
  | "AMBIGUOUS_PICK"
  | "AMBIGUOUS_PUT_BACK"
  | "ZONE_UNKNOWN"
  | "MISSING_SESSION"
  | "DELAYED_EVENT"
  | "CONFLICT";
export type NextAction = "CUSTOMER_CONFIRM" | "STAFF_HITL" | "CLOSE";
export type ProposedAction = "ADD_ITEM" | "REMOVE_ITEM" | "REVIEW_CART";

export interface Product {
  sku: Sku;
  name: string;
  price: number;
  color: string;
}

export interface Session {
  sessionId: string;
  basketId: BasketId;
  status: "ACTIVE" | "CLOSED";
  startedAt: string;
  closedAt?: string;
}

export interface CartLine {
  sku: Sku;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export interface Basket {
  basketId: BasketId;
  session: Session | null;
  lines: CartLine[];
  total: number;
  payable: boolean;
  unresolvedCaseCount: number;
}

export interface RssiReadings {
  A: number | null;
  B: number | null;
  HV01?: number | null;
}

export interface Shelf {
  shelfId: string;
  label?: string;
  enabled?: boolean;
  status: string;
  lastSeenAt: string | null;
  fsmState: string;
  rssi: RssiReadings;
  lastEventId: string | null;
  device?: {
    status: "UNKNOWN" | "ONLINE" | "OFFLINE";
    lastSeenAt: string | null;
    source: "DEVICE" | null;
    timeoutMs: number;
    rssi: RssiReadings;
    lanes: { laneId: string; present: boolean }[];
    uptimeMs: number | null;
    queueDepth: number | null;
    droppedEvents: number | null;
  };
}

export interface Evidence {
  rssi?: RssiReadings;
  zone?: string;
  marginDb?: number;
  session?: Session | null;
  cartQuantity?: number;
  delayed?: boolean;
}

export interface ToolCall {
  name: string;
  status: string;
  calledAt?: string;
  input?: unknown;
  result?: unknown;
  summary?: string;
}

export interface TimelineEntry {
  at: string;
  action: string;
  basketId?: BasketId;
  nextAction?: NextAction;
  reason?: string;
}

export interface Resolution {
  actor: "CUSTOMER" | "STAFF";
  decision: string;
  basketId?: BasketId;
}

export interface BasketCase {
  caseId: string;
  eventId: string;
  shelfId?: string;
  type: CaseType;
  eventType: EventType;
  sku: Sku;
  status: CaseStatus;
  candidate: BasketId | null;
  confidence: number;
  nextAction: NextAction;
  proposedAction: ProposedAction;
  evidence: Evidence;
  toolCalls: ToolCall[];
  reason: string;
  createdAt: string;
  updatedAt: string;
  timeline: TimelineEntry[];
  resolution?: Resolution;
  agent?: {
    provider: string;
    status: "RUNNING" | "COMPLETED" | "FAILED";
    error?: string;
    mode?: "WORKFLOW" | "AGENTIC";
    steps?: {
      number: number;
      phase: "SELECT" | "OBSERVE";
      action: string;
      source?: "MODEL" | "POLICY";
      durationMs?: number;
      remainingTimeMs?: number;
      summary: string;
      model?: string;
      confidence?: number;
      availableActions?: string[];
    }[];
    output?: {
      model?: string;
      confidenceSource?: string;
      requestDurationMs?: number;
      probabilities?: Record<string, number>;
    };
  };
}

export interface AuditEntry {
  auditId: string;
  at: string;
  action: string;
  actor: string;
  details: Record<string, unknown>;
}

export interface ShelfEvent {
  eventId: string;
  shelfId: string;
  laneId: string;
  sku: Sku;
  eventType: EventType;
  timestamp: string;
  receivedAt: string;
  rssi: RssiReadings;
}

export interface OrderLine {
  sku: Sku;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Order {
  orderId: string;
  basketId: BasketId;
  lines: OrderLine[];
  total: number;
  createdAt: string;
  paymentMode: "MOCK";
}

export interface ApiState {
  products: Product[];
  shelf: Shelf;
  shelves?: Shelf[];
  baskets: Basket[];
  cases: BasketCase[];
  recentEvents: ShelfEvent[];
  recentOrders: Order[];
  auditLog?: AuditEntry[];
  policy: {
    clearMarginDb: number;
    customerConfirmThreshold: number;
  };
}

export interface ShelfEventInput {
  eventId: string;
  laneId: string;
  eventType: EventType;
  shelfId?: string;
  sku?: Sku;
  timestamp?: string;
  delayed?: boolean;
  rssi?: Partial<Record<BasketId | "HV01", number | null>>;
}

export type ProcessShelfEventResult =
  | { duplicate: true; eventId: string }
  | {
      duplicate: false;
      event: ShelfEvent;
      disposition: "CONFIRMED";
      basketId: BasketId;
    }
  | {
      duplicate: false;
      event: ShelfEvent;
      disposition: "PENDING" | "CONFLICT";
      caseId: string;
    };
