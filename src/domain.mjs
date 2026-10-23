import { randomUUID } from "node:crypto";
import { deviceState } from "./device-state.mjs";
import { shelfStates } from "./shelves.mjs";

const PRODUCT_BY_LANE = {
  "LANE-1": "COKE",
  "LANE-2": "WATER",
  "LANE-COKE": "COKE",
  "LANE-WATER": "WATER",
};

const BASKETS = ["A", "B"];
const RSSI_CLEAR_MARGIN_DB = 10;
const CUSTOMER_CONFIRM_THRESHOLD = 0.75;
const AUDIT_LOG_LIMIT = 500;

export function createStore() {
  return {
    products: {
      COKE: { sku: "COKE", name: "Coca-Cola", price: 25, color: "#d84f3f" },
      WATER: { sku: "WATER", name: "Mineral water", price: 15, color: "#4e91ad" },
    },
    sessions: [],
    activeSessions: { A: null, B: null },
    carts: { A: {}, B: {} },
    events: [],
    cases: [],
    orders: [],
    auditLog: [],
    telemetry: [],
    cameraEvidence: [],
    seenEventIds: [],
    caseSequence: 0,
    shelf: {
      shelfId: "SHELF-01",
      status: "ONLINE",
      lastSeenAt: new Date().toISOString(),
      fsmState: "IDLE",
      rssi: { A: null, B: null },
      lastEventId: null,
    },
  };
}

function isoNow() {
  return new Date().toISOString();
}

export function addAuditEntry(store, action, actor, details = {}) {
  const entry = {
    auditId: "AUD-" + randomUUID().slice(0, 12).toUpperCase(),
    at: isoNow(),
    action,
    actor,
    details,
  };
  store.auditLog ||= [];
  store.auditLog.unshift(entry);
  store.auditLog = store.auditLog.slice(0, AUDIT_LOG_LIMIT);
  return entry;
}

function activeSession(store, basketId) {
  const id = store.activeSessions[basketId];
  return store.sessions.find((session) => session.sessionId === id && session.status === "ACTIVE");
}

function addTimeline(caseItem, action, detail = {}) {
  caseItem.timeline.push({ at: isoNow(), action, ...detail });
}

function applyCartEvent(store, basketId, event) {
  if (!BASKETS.includes(basketId) || !activeSession(store, basketId)) return false;
  const current = store.carts[basketId][event.sku] || 0;
  if (event.eventType === "PICK") {
    store.carts[basketId][event.sku] = current + 1;
    return true;
  }
  if (current < 1) return false;
  if (current === 1) delete store.carts[basketId][event.sku];
  else store.carts[basketId][event.sku] = current - 1;
  return true;
}

function createCase(store, event, details) {
  store.caseSequence += 1;
  const caseItem = {
    caseId: "CASE-" + String(store.caseSequence).padStart(3, "0"),
    eventId: event.eventId,
    shelfId: event.shelfId,
    type: details.type,
    eventType: event.eventType,
    sku: event.sku,
    status: details.nextAction === "CUSTOMER_CONFIRM" ? "WAITING_CUSTOMER" : "OPEN_STAFF",
    candidate: details.candidate || null,
    confidence: details.confidence ?? 0,
    nextAction: details.nextAction,
    proposedAction: details.proposedAction,
    evidence: details.evidence || {},
    toolCalls: details.toolCalls || [],
    reason: details.reason || "",
    createdAt: isoNow(),
    updatedAt: isoNow(),
    timeline: [],
  };
  addTimeline(caseItem, "CASE_CREATED", { nextAction: caseItem.nextAction, reason: caseItem.reason });
  store.cases.unshift(caseItem);
  addAuditEntry(store, "CASE_CREATED", "FSM", {
    caseId: caseItem.caseId,
    eventId: event.eventId,
    type: caseItem.type,
    nextAction: caseItem.nextAction,
  });
  return caseItem;
}

function chooseBasket(rssi) {
  if (!rssi || !Number.isFinite(rssi.A) || !Number.isFinite(rssi.B)) return null;
  if (rssi.A === rssi.B) return null;
  return rssi.A > rssi.B ? "A" : "B";
}

function recordEvent(store, event) {
  store.events.unshift(event);
  store.events = store.events.slice(0, 100);
  store.shelf.lastSeenAt = event.receivedAt;
  store.shelf.lastEventId = event.eventId;
  store.shelf.rssi = event.rssi || { A: null, B: null };
}

export function processShelfEvent(store, input) {
  if (!input || typeof input !== "object") throw new Error("Event payload must be an object");
  const eventId = String(input.eventId || "").trim();
  const eventType = String(input.eventType || "").toUpperCase();
  const sku = PRODUCT_BY_LANE[String(input.laneId || "").toUpperCase()];
  if (!eventId) throw new Error("eventId is required");
  if (store.seenEventIds.includes(eventId)) {
    addAuditEntry(store, "DUPLICATE_EVENT_IGNORED", "FSM", { eventId });
    return { duplicate: true, auditOnly: true, eventId };
  }
  if (input.delayed !== undefined && typeof input.delayed !== "boolean") {
    throw new Error("delayed must be a boolean");
  }
  if (!sku) throw new Error("laneId must be LANE-1 or LANE-2");
  if (input.sku && input.sku !== sku) throw new Error("sku does not match laneId");
  if (!["PICK", "PUT_BACK"].includes(eventType)) throw new Error("eventType must be PICK or PUT_BACK");

  const rawRssi = input.rssi && typeof input.rssi === "object" ? input.rssi : {};
  const normalizeRssi = (value) => {
    if (!Number.isFinite(value)) return null;
    if (value < -127 || value > 0) throw new Error("RSSI must be between -127 and 0 dBm");
    return value;
  };
  const rssi = { A: normalizeRssi(rawRssi.A), B: normalizeRssi(rawRssi.B) };
  // Asset proximity is supporting evidence only; it never selects a payable basket.
  if (Object.hasOwn(rawRssi, "HV01")) rssi.HV01 = normalizeRssi(rawRssi.HV01);
  const event = {
    eventId,
    shelfId: String(input.shelfId || store.shelf.shelfId),
    laneId: String(input.laneId).toUpperCase(),
    sku,
    eventType,
    timestamp: input.timestamp || isoNow(),
    timeBasis: input.timestamp ? "SOURCE_TIMESTAMP" : "SERVER_RECEIPT",
    receivedAt: isoNow(),
    delayed: input.delayed === true,
    rssi,
  };

  store.seenEventIds.push(eventId);
  store.seenEventIds = store.seenEventIds.slice(-2000);
  recordEvent(store, event);
  addAuditEntry(store, "SHELF_EVENT_RECEIVED", "DEVICE", {
    eventId: event.eventId,
    shelfId: event.shelfId,
    laneId: event.laneId,
    sku: event.sku,
    eventType: event.eventType,
    delayed: event.delayed,
  });
  store.shelf.fsmState = "PROCESSING_" + eventType;

  if (event.delayed) {
    const caseItem = createCase(store, event, {
      type: "DELAYED_EVENT",
      candidate: null,
      confidence: 0,
      nextAction: "STAFF_HITL",
      proposedAction: eventType === "PICK" ? "ADD_ITEM" : "REMOVE_ITEM",
      evidence: { rssi, zone: "DELAYED", delayed: true },
      reason: "The device marked this event delayed or backlogged; its proximity evidence is not safe for automatic assignment.",
    });
    store.shelf.fsmState = "WAITING_STAFF";
    return { duplicate: false, event, disposition: "PENDING", caseId: caseItem.caseId };
  }

  if (!Number.isFinite(rssi.A) || !Number.isFinite(rssi.B)) {
    const caseItem = createCase(store, event, {
      type: "ZONE_UNKNOWN",
      candidate: null,
      confidence: 0,
      nextAction: "STAFF_HITL",
      proposedAction: eventType === "PICK" ? "ADD_ITEM" : "REMOVE_ITEM",
      evidence: { rssi, zone: "ZONE_UNKNOWN" },
      reason: "Basket RSSI evidence is missing; the item stays out of every payable cart.",
    });
    store.shelf.fsmState = "WAITING_STAFF";
    return { duplicate: false, event, disposition: "PENDING", caseId: caseItem.caseId };
  }

  const margin = Math.abs(rssi.A - rssi.B);
  const candidate = chooseBasket(rssi);

  if (margin >= RSSI_CLEAR_MARGIN_DB && candidate) {
    if (!activeSession(store, candidate)) {
      const caseItem = createCase(store, event, {
        type: "MISSING_SESSION",
        candidate,
        confidence: 1,
        nextAction: "STAFF_HITL",
        proposedAction: eventType === "PICK" ? "ADD_ITEM" : "REMOVE_ITEM",
        evidence: { rssi, marginDb: margin, zone: "CLEAR", session: null },
        reason: "The nearest basket has no active shopper session.",
      });
      store.shelf.fsmState = "WAITING_STAFF";
      return { duplicate: false, event, disposition: "PENDING", caseId: caseItem.caseId };
    }

    if (!applyCartEvent(store, candidate, event)) {
      const caseItem = createCase(store, event, {
        type: "CONFLICT",
        candidate,
        confidence: 1,
        nextAction: "STAFF_HITL",
        proposedAction: "REVIEW_CART",
        evidence: { rssi, marginDb: margin, zone: "CLEAR", cartQuantity: store.carts[candidate][sku] || 0 },
        reason: "PUT_BACK does not match a confirmed item in this basket.",
      });
      store.shelf.fsmState = "WAITING_STAFF";
      return { duplicate: false, event, disposition: "CONFLICT", caseId: caseItem.caseId };
    }

    store.shelf.fsmState = "CART_UPDATED";
    addAuditEntry(store, "CART_UPDATED", "FSM", {
      eventId: event.eventId,
      basketId: candidate,
      sku: event.sku,
      eventType: event.eventType,
    });
    return { duplicate: false, event, disposition: "CONFIRMED", basketId: candidate };
  }

  const caseItem = createCase(store, event, {
    type: eventType === "PICK" ? "AMBIGUOUS_PICK" : "AMBIGUOUS_PUT_BACK",
    candidate: null,
    confidence: 0,
    nextAction: "INVESTIGATE",
    proposedAction: eventType === "PICK" ? "ADD_ITEM" : "REMOVE_ITEM",
    evidence: { rssi, marginDb: margin, zone: "AMBIGUOUS" },
    reason: "RSSI difference is below the clear-zone threshold; the case manager will inspect supporting evidence.",
  });
  store.shelf.fsmState = "AGENT_INVESTIGATING";
  return { duplicate: false, event, disposition: "PENDING", caseId: caseItem.caseId };
}

export function startSession(store, basketId) {
  if (!BASKETS.includes(basketId)) throw new Error("basketId must be A or B");
  const existing = activeSession(store, basketId);
  if (existing) return existing;
  const session = {
    sessionId: "SES-" + randomUUID().slice(0, 8).toUpperCase(),
    basketId,
    status: "ACTIVE",
    startedAt: isoNow(),
  };
  store.sessions.unshift(session);
  store.activeSessions[basketId] = session.sessionId;
  store.carts[basketId] = {};
  addAuditEntry(store, "SESSION_STARTED", "SHOPPER", { basketId, sessionId: session.sessionId });
  return session;
}

function findCase(store, caseId) {
  const caseItem = store.cases.find((item) => item.caseId === caseId);
  if (!caseItem) throw new Error("Case not found");
  if (caseItem.agent?.status === "RUNNING") throw new Error("Agent investigation is still in progress");
  if (!["WAITING_CUSTOMER", "OPEN_STAFF"].includes(caseItem.status)) {
    throw new Error("Case is already closed");
  }
  return caseItem;
}

export function customerDecision(store, caseId, answer) {
  const caseItem = findCase(store, caseId);
  if (caseItem.status !== "WAITING_CUSTOMER") throw new Error("This case is not waiting for customer confirmation");
  if (answer === "YES") {
    if (applyCartEvent(store, caseItem.candidate, caseItem)) {
      caseItem.status = "CLOSED";
      caseItem.nextAction = "CLOSE";
      caseItem.resolution = { actor: "CUSTOMER", decision: "YES", basketId: caseItem.candidate };
      addTimeline(caseItem, "CUSTOMER_CONFIRMED", { basketId: caseItem.candidate });
      addAuditEntry(store, "CUSTOMER_CONFIRMED", "CUSTOMER", {
        caseId,
        basketId: caseItem.candidate,
        eventId: caseItem.eventId,
      });
      addAuditEntry(store, "CART_VALIDATED", "VALIDATOR", { caseId, basketId: caseItem.candidate });
    } else {
      caseItem.status = "OPEN_STAFF";
      caseItem.nextAction = "STAFF_HITL";
      caseItem.reason = "Customer confirmed, but cart validation failed.";
      addTimeline(caseItem, "VALIDATION_FAILED", { nextAction: "STAFF_HITL" });
      addAuditEntry(store, "CART_VALIDATION_FAILED", "VALIDATOR", { caseId, nextAction: "STAFF_HITL" });
    }
  } else if (answer === "NO") {
    caseItem.status = "OPEN_STAFF";
    caseItem.nextAction = "STAFF_HITL";
    caseItem.reason = "Customer declined the suggestion; staff review is required.";
    addTimeline(caseItem, "CUSTOMER_DECLINED", { nextAction: "STAFF_HITL" });
    addAuditEntry(store, "CUSTOMER_DECLINED", "CUSTOMER", { caseId, eventId: caseItem.eventId });
  } else {
    throw new Error("answer must be YES or NO");
  }
  caseItem.updatedAt = isoNow();
  addAuditEntry(store, "CASE_STATUS_CHANGED", "WORKFLOW", {
    caseId,
    status: caseItem.status,
    nextAction: caseItem.nextAction,
  });
  store.shelf.fsmState = caseItem.status === "CLOSED" ? "CART_UPDATED" : "WAITING_STAFF";
  return caseItem;
}

export function staffDecision(store, caseId, decision, basketId) {
  const caseItem = findCase(store, caseId);
  if (decision === "APPROVE") {
    const selectedBasket = BASKETS.includes(basketId) ? basketId : caseItem.candidate;
    if (!selectedBasket) throw new Error("Choose basket A or B to approve this case");
    if (!applyCartEvent(store, selectedBasket, caseItem)) {
      throw new Error("Cart validation failed; no payable cart was changed");
    }
    caseItem.resolution = { actor: "STAFF", decision, basketId: selectedBasket };
    addTimeline(caseItem, "STAFF_APPROVED", { basketId: selectedBasket });
    addAuditEntry(store, "STAFF_APPROVED", "STAFF", {
      caseId,
      basketId: selectedBasket,
      eventId: caseItem.eventId,
    });
    addAuditEntry(store, "CART_VALIDATED", "VALIDATOR", { caseId, basketId: selectedBasket });
  } else if (decision === "REJECT") {
    caseItem.resolution = { actor: "STAFF", decision };
    addTimeline(caseItem, "STAFF_REJECTED");
    addAuditEntry(store, "STAFF_REJECTED", "STAFF", { caseId, eventId: caseItem.eventId });
  } else {
    throw new Error("decision must be APPROVE or REJECT");
  }
  caseItem.status = "CLOSED";
  caseItem.nextAction = "CLOSE";
  caseItem.updatedAt = isoNow();
  addAuditEntry(store, "CASE_CLOSED", "WORKFLOW", {
    caseId,
    decision,
    resolution: caseItem.resolution,
  });
  store.shelf.fsmState = decision === "APPROVE" ? "CART_UPDATED" : "CASE_CLOSED";
  return caseItem;
}

export function checkout(store, basketId) {
  if (!BASKETS.includes(basketId)) throw new Error("basketId must be A or B");
  if (!activeSession(store, basketId)) throw new Error("Start a basket session before checkout");
  const openCases = store.cases.filter(
    (item) => ["WAITING_CUSTOMER", "OPEN_STAFF"].includes(item.status) &&
      (!item.candidate || item.candidate === basketId || item.evidence.zone === "ZONE_UNKNOWN"),
  );
  if (openCases.length) throw new Error("Resolve pending cases before mock checkout");
  const lines = Object.entries(store.carts[basketId]).map(([sku, quantity]) => ({
    sku,
    name: store.products[sku].name,
    quantity,
    unitPrice: store.products[sku].price,
    subtotal: quantity * store.products[sku].price,
  }));
  if (!lines.length) throw new Error("Cart has no confirmed items");
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const order = {
    orderId: "MOCK-" + randomUUID().slice(0, 8).toUpperCase(),
    basketId,
    lines,
    total,
    createdAt: isoNow(),
    paymentMode: "MOCK",
  };
  store.orders.unshift(order);
  store.carts[basketId] = {};
  const session = activeSession(store, basketId);
  session.status = "CLOSED";
  session.closedAt = order.createdAt;
  store.activeSessions[basketId] = null;
  store.shelf.fsmState = "MOCK_CHECKOUT";
  addAuditEntry(store, "MOCK_CHECKOUT_COMPLETED", "SHOPPER", {
    orderId: order.orderId,
    basketId,
    total: order.total,
  });
  return order;
}

export function snapshot(store, now = Date.now()) {
  const baskets = BASKETS.map((basketId) => {
    const lines = Object.entries(store.carts[basketId]).map(([sku, quantity]) => ({
      sku,
      name: store.products[sku].name,
      price: store.products[sku].price,
      quantity,
      subtotal: store.products[sku].price * quantity,
    }));
    const unresolved = store.cases.filter(
      (item) => ["WAITING_CUSTOMER", "OPEN_STAFF"].includes(item.status) &&
        (!item.candidate || item.candidate === basketId || item.evidence.zone === "ZONE_UNKNOWN"),
    );
    return {
      basketId,
      session: activeSession(store, basketId) || null,
      lines,
      total: lines.reduce((sum, line) => sum + line.subtotal, 0),
      payable: Boolean(activeSession(store, basketId)) && unresolved.length === 0,
      unresolvedCaseCount: unresolved.length,
    };
  });

  return {
    products: Object.values(store.products),
    shelf: { ...store.shelf, device: deviceState(store, now) },
    shelves: shelfStates(store, now),
    baskets,
    cases: store.cases.slice(0, 30),
    recentEvents: store.events.slice(0, 20),
    recentOrders: store.orders.slice(0, 10),
    auditLog: (store.auditLog || []).slice(0, 100),
    policy: { clearMarginDb: RSSI_CLEAR_MARGIN_DB, customerConfirmThreshold: CUSTOMER_CONFIRM_THRESHOLD },
  };
}
