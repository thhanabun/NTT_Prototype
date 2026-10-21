function getActiveSession(store, basketId) {
  const sessionId = store.activeSessions[basketId];
  return store.sessions.find((session) => session.sessionId === sessionId && session.status === "ACTIVE") || null;
}

function chooseCandidate(rssi) {
  if (!Number.isFinite(rssi?.A) || !Number.isFinite(rssi?.B) || rssi.A === rssi.B) return null;
  return rssi.A > rssi.B ? "A" : "B";
}

export function getShelfEvent(store, { eventId } = {}) {
  const event = store.events.find((item) => item.eventId === String(eventId || ""));
  return { found: Boolean(event), event: event || null };
}

export function getBasketEvidence(store, { eventId } = {}) {
  const event = store.events.find((item) => item.eventId === String(eventId || ""));
  if (!event) return { found: false, eventId: String(eventId || ""), zone: "ZONE_UNKNOWN" };

  const rssi = event.rssi || { A: null, B: null };
  const bothFresh = Number.isFinite(rssi.A) && Number.isFinite(rssi.B);
  const marginDb = bothFresh ? Math.abs(rssi.A - rssi.B) : null;
  const candidate = bothFresh ? chooseCandidate(rssi) : null;
  const activeSessions = {
    A: Boolean(getActiveSession(store, "A")),
    B: Boolean(getActiveSession(store, "B")),
  };
  return {
    found: true,
    eventId: event.eventId,
    shelfId: event.shelfId,
    laneId: event.laneId,
    sku: event.sku,
    eventType: event.eventType,
    delayed: event.delayed === true,
    rssi,
    marginDb,
    candidate,
    activeSessions,
    zone: event.delayed ? "DELAYED" : !bothFresh ? "ZONE_UNKNOWN" : marginDb >= 10 ? "CLEAR" : "AMBIGUOUS",
  };
}

export function getCartHistory(store) {
  return {
    baskets: ["A", "B"].map((basketId) => ({
      basketId,
      activeSession: getActiveSession(store, basketId),
      cart: Object.entries(store.carts[basketId] || {}).map(([sku, quantity]) => ({
        sku,
        name: store.products[sku]?.name || sku,
        quantity,
      })),
      recentOrders: store.orders.filter((order) => order.basketId === basketId).slice(0, 3),
      recentResolutions: store.cases
        .filter((caseItem) => caseItem.resolution?.basketId === basketId)
        .slice(0, 5)
        .map((caseItem) => ({
          caseId: caseItem.caseId,
          eventId: caseItem.eventId,
          resolution: caseItem.resolution,
          resolvedAt: caseItem.updatedAt,
        })),
    })),
  };
}

export const AGENT_TOOLS = Object.freeze({
  get_shelf_event: getShelfEvent,
  get_basket_evidence: getBasketEvidence,
  get_cart_history: getCartHistory,
});

export function runAgentTool(store, name, parameters = {}) {
  const tool = AGENT_TOOLS[name];
  if (!tool) throw new Error(`Unknown agent tool: ${name}`);
  return tool(store, parameters);
}
