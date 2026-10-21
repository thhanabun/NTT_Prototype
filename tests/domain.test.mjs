import test from "node:test";
import assert from "node:assert/strict";
import { investigateCase } from "../src/agent/case-manager.mjs";
import {
  checkout,
  createStore,
  customerDecision,
  processShelfEvent,
  snapshot,
  staffDecision,
  startSession,
} from "../src/domain.mjs";

function event(eventId, rssi, eventType = "PICK", laneId = "LANE-1") {
  return { eventId, shelfId: "SHELF-01", laneId, eventType, timestamp: new Date().toISOString(), rssi };
}

test("clear pick is deterministic and duplicate delivery cannot double-add", () => {
  const store = createStore();
  startSession(store, "A");

  const payload = event("clear-1", { A: -51, B: -72 });
  const result = processShelfEvent(store, payload);
  const duplicate = processShelfEvent(store, payload);

  assert.equal(result.disposition, "CONFIRMED");
  assert.equal(result.basketId, "A");
  assert.equal(duplicate.duplicate, true);
  assert.equal(snapshot(store).baskets.find((basket) => basket.basketId === "A").total, 25);
  assert.equal(store.cases.length, 0);
});

test("ambiguous pick stays non-payable until customer confirmation", () => {
  const store = createStore();
  startSession(store, "A");

  const result = processShelfEvent(store, event("ambiguous-1", { A: -55, B: -57 }));
  const caseItem = investigateCase(store, result.caseId);
  const basket = snapshot(store).baskets.find((item) => item.basketId === "A");

  assert.equal(result.disposition, "PENDING");
  assert.equal(basket.total, 0);
  assert.equal(basket.payable, false);
  assert.equal(caseItem.confidence, 0.82);
  assert.equal(caseItem.nextAction, "CUSTOMER_CONFIRM");
  assert.equal(caseItem.agent.provider, "MOCK");
  assert.equal(caseItem.toolCalls.length, 3);
  assert.equal(caseItem.toolCalls[0].name, "get_shelf_event");
  assert.equal(caseItem.toolCalls[1].name, "get_basket_evidence");
  assert.equal(caseItem.toolCalls[2].name, "get_cart_history");
  customerDecision(store, result.caseId, "YES");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "A").total, 25);
  assert.ok(store.auditLog.some((entry) => entry.action === "AGENT_RECOMMENDATION"));
  assert.ok(store.auditLog.some((entry) => entry.action === "CART_VALIDATED"));
});

test("tied RSSI is sent to staff and blocks checkout until resolved", () => {
  const store = createStore();
  startSession(store, "A");
  startSession(store, "B");
  const result = processShelfEvent(store, event("tie-1", { A: -56, B: -56 }));
  const caseItem = investigateCase(store, result.caseId);

  assert.equal(caseItem.nextAction, "STAFF_HITL");
  assert.equal(caseItem.confidence, 0.55);
  assert.throws(() => checkout(store, "A"), /Resolve pending cases/);
  staffDecision(store, result.caseId, "APPROVE", "B");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "B").total, 25);
});

test("Customer NO keeps the cart unchanged, escalates to staff, and accepts only one final decision (policy fixture)", () => {
  const store = createStore();
  startSession(store, "A");
  const result = processShelfEvent(store, event("customer-no", { A: -55, B: -57 }));
  const caseItem = investigateCase(store, result.caseId);
  assert.equal(caseItem.status, "WAITING_CUSTOMER");
  customerDecision(store, result.caseId, "NO");
  assert.equal(caseItem.status, "OPEN_STAFF");
  assert.equal(caseItem.nextAction, "STAFF_HITL");
  assert.equal(snapshot(store).baskets[0].total, 0);
  assert.throws(() => checkout(store, "A"), /pending/i);
  staffDecision(store, result.caseId, "REJECT");
  assert.equal(caseItem.status, "CLOSED");
  assert.equal(snapshot(store).baskets[0].total, 0);
  assert.throws(() => staffDecision(store, result.caseId, "APPROVE", "A"), /closed/i);
  assert.ok(store.auditLog.some((entry) => entry.action === "CUSTOMER_DECLINED"));
});

test("clear events bypass the agent, while ambiguous recommendations are audited", () => {
  const store = createStore();
  startSession(store, "A");
  const clear = processShelfEvent(store, event("clear-no-agent", { A: -50, B: -70 }));
  assert.equal(clear.disposition, "CONFIRMED");
  assert.equal(store.cases.length, 0);

  const ambiguous = processShelfEvent(store, event("ambiguous-audit", { A: -55, B: -57 }));
  const caseItem = investigateCase(store, ambiguous.caseId);
  const actions = store.auditLog.map((entry) => entry.action);
  assert.equal(caseItem.agent.toolCallCount, 3);
  assert.ok(actions.includes("AGENT_STARTED"));
  assert.equal(actions.filter((action) => action === "AGENT_TOOL_COMPLETED").length, 3);
  assert.ok(actions.includes("AGENT_RECOMMENDATION"));
});

test("missing BLE evidence never assigns an item to the other basket", () => {
  const store = createStore();
  startSession(store, "A");
  startSession(store, "B");
  const result = processShelfEvent(store, event("unknown-1", { A: null, B: null }));

  assert.equal(store.cases[0].type, "ZONE_UNKNOWN");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "A").total, 0);
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "B").total, 0);
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "B").payable, false);
  staffDecision(store, result.caseId, "REJECT");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "A").payable, true);
});

test("delayed device events cannot use stale RSSI to change a payable cart", () => {
  const store = createStore();
  startSession(store, "A");
  startSession(store, "B");
  const result = processShelfEvent(store, {
    ...event("delayed-1", { A: -45, B: -80 }),
    delayed: true,
  });

  assert.equal(result.disposition, "PENDING");
  assert.equal(store.cases[0].type, "DELAYED_EVENT");
  assert.equal(store.cases[0].candidate, null);
  assert.equal(store.cases[0].nextAction, "STAFF_HITL");
  assert.equal(snapshot(store).baskets.find((basket) => basket.basketId === "A").total, 0);
  assert.equal(snapshot(store).baskets.find((basket) => basket.basketId === "B").payable, false);
  assert.throws(() => processShelfEvent(store, {
    ...event("invalid-delay-flag", { A: -45, B: -80 }),
    delayed: "true",
  }), /delayed must be a boolean/);
});

test("put-back cannot create negative quantity", () => {
  const store = createStore();
  startSession(store, "A");
  const result = processShelfEvent(store, event("return-1", { A: -50, B: -75 }, "PUT_BACK"));

  assert.equal(result.disposition, "CONFLICT");
  assert.equal(store.cases[0].type, "CONFLICT");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "A").total, 0);
});

test("put-back removes only an existing confirmed item", () => {
  const store = createStore();
  startSession(store, "A");
  processShelfEvent(store, event("pick-first", { A: -50, B: -75 }, "PICK"));
  const result = processShelfEvent(store, event("return-first", { A: -50, B: -75 }, "PUT_BACK"));

  assert.equal(result.disposition, "CONFIRMED");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "A").total, 0);
  assert.equal(store.cases.length, 0);
});

test("mock checkout closes a clean nonempty session", () => {
  const store = createStore();
  startSession(store, "A");
  processShelfEvent(store, event("checkout-pick", { A: -50, B: -75 }));
  const order = checkout(store, "A");

  assert.equal(order.total, 25);
  assert.equal(order.paymentMode, "MOCK");
  assert.equal(snapshot(store).baskets.find((item) => item.basketId === "A").session, null);
});
