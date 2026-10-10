export type BasketId = "A" | "B";
export type Sku = "COKE" | "WATER";
export type EventType = "PICK" | "PUT_BACK";
export type CaseStatus = "WAITING_CUSTOMER" | "OPEN_STAFF" | "CLOSED";
export type CaseType =
  | "AMBIGUOUS_PICK"
  | "AMBIGUOUS_PUT_BACK"
  | "ZONE_UNKNOWN"
  | "MISSING_SESSION"
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
}

export interface Shelf {
  shelfId: string;
  status: string;
  lastSeenAt: string;
  fsmState: string;
  rssi: RssiReadings;
  lastEventId: string | null;
}

export interface Evidence {
  rssi?: RssiReadings;
  zone?: string;
  marginDb?: number;
  session?: Session | null;
  cartQuantity?: number;
}

export interface ToolCall {
  name: string;
  status: string;
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
  baskets: Basket[];
  cases: BasketCase[];
  recentEvents: ShelfEvent[];
  recentOrders: Order[];
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
  rssi?: Partial<Record<BasketId, number | null>>;
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
