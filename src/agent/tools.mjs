import { ANALYSIS_SCRIPTS, SCRIPT_DESCRIPTIONS } from "./analysis-scripts.mjs";

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

function sourceEvent(store, eventId) {
  const event = getShelfEvent(store, { eventId }).event;
  if (!event) throw new Error("Source event not found");
  return event;
}

function windowSamples(store, event, windowMs = 3000) {
  // Unsynchronized firmware has receipt time only; never label that as capture-time proof.
  const timeBasis = event.delayed ? "DELAYED_UNRELIABLE" : "SERVER_RECEIPT";
  const center = Date.parse(event.receivedAt);
  const samples = (store.telemetry || []).filter(sample => sample.shelfId === event.shelfId &&
    Math.abs(Date.parse(sample.receivedAt) - center) <= windowMs &&
    (sample.timeBasis !== "SOURCE_TIMESTAMP" || Math.abs(Date.parse(sample.capturedAt) - Date.parse(sample.receivedAt)) <= 3000)).slice(0, 12);
  return { timeBasis, samples };
}

export function getSignalWindow(store, { eventId } = {}) {
  const event = sourceEvent(store, eventId);
  const window = windowSamples(store, event);
  return { status: window.samples.length ? "AVAILABLE" : "NO_DATA", eventId, windowMs: 3000, ...window };
}

export function getDeviceHealth(store, { eventId } = {}) {
  const event = sourceEvent(store, eventId);
  const { samples } = windowSamples(store, event, 5000);
  const sample = samples[0];
  if (!sample) return { status: "UNKNOWN", eventId, reason: "No telemetry near this event; event traffic is not a device heartbeat." };
  const ageMs = Math.max(0, Date.now() - Date.parse(sample.receivedAt));
  const chronological = [...samples].reverse();
  const rebootObserved = chronological.some((item, index) => index > 0 && item.uptimeMs !== null && chronological[index - 1].uptimeMs !== null && item.uptimeMs < chronological[index - 1].uptimeMs);
  const droppedDuringWindow = chronological.length > 1 && sample.droppedEvents !== null && chronological[0].droppedEvents !== null && sample.droppedEvents > chronological[0].droppedEvents;
  // One queued event is expected while this event is waiting for the application ACK.
  const backlog = sample.queueDepth > 1;
  const partial = sample.queueDepth === null || sample.droppedEvents === null || sample.uptimeMs === null;
  return { status: rebootObserved || droppedDuringWindow || backlog ? "DEGRADED" : ageMs > 5000 ? "STALE" : partial ? "PARTIAL" : "HEALTHY", eventId, ageMs, rebootObserved, droppedDuringWindow, backlog, queueDepth: sample.queueDepth, droppedEvents: sample.droppedEvents, source: sample.source, timeBasis: "SERVER_RECEIPT" };
}

function canonicalLane(id) {
  return ({ "LANE-COKE": "LANE-1", "LANE-WATER": "LANE-2" })[id] || id;
}

export function getLaneState(store, { eventId } = {}) {
  const event = sourceEvent(store, eventId);
  const samples = windowSamples(store, event).samples;
  for (const sample of samples) {
    const lane = sample.lanes.find(item => canonicalLane(item.laneId) === canonicalLane(event.laneId));
    if (lane) return { status: "AVAILABLE", eventId, sample: { ...lane, capturedAt: sample.capturedAt, receivedAt: sample.receivedAt, timeBasis: sample.timeBasis, source: sample.source } };
  }
  return { status: "UNKNOWN", eventId, reason: "No reported switch state near this event. Shelf events are not independent switch evidence." };
}

export function getEventNeighbors(store, { eventId } = {}) {
  const event = sourceEvent(store, eventId);
  const events = store.events.filter(item => item.shelfId === event.shelfId && canonicalLane(item.laneId) === canonicalLane(event.laneId) &&
    Math.abs(Date.parse(item.receivedAt) - Date.parse(event.receivedAt)) <= 3000).slice(0, 12);
  return { status: "AVAILABLE", eventId, windowMs: 3000, timeBasis: "SERVER_RECEIPT", events };
}

export function getCameraEvidence(store, { eventId } = {}) {
  const event = sourceEvent(store, eventId);
  const samples = (store.cameraEvidence || []).filter(item => item.eventId === eventId).slice(0, 3);
  const observations = samples.map(item => ({ ...item, aligned: item.timeBasis === "SOURCE_TIMESTAMP" && event.timeBasis === "SOURCE_TIMESTAMP" && !event.delayed && Math.abs(Date.parse(item.capturedAt) - Date.parse(event.timestamp)) <= 3000 }));
  return { status: observations.length ? "AVAILABLE" : "NO_DATA", eventId, observations, limitation: "Reported observations only; this tool does not capture RTSP or run vision inference. MOCK observations remain labelled." };
}

export function runEvidenceAnalysis(store, { eventId, scriptId } = {}) {
  const script = Object.hasOwn(ANALYSIS_SCRIPTS, scriptId) ? ANALYSIS_SCRIPTS[scriptId] : null;
  if (!script) throw new Error("Unknown evidence analysis script");
  const event = sourceEvent(store, eventId);
  return { scriptId, ...script({ event, signal: getSignalWindow(store, { eventId }), neighbors: getEventNeighbors(store, { eventId }), lane: getLaneState(store, { eventId }), history: getCartHistory(store) }) };
}

export const TOOL_DESCRIPTIONS = Object.freeze({
  get_shelf_event: "Read source PICK/PUT_BACK, lane, SKU and delayed flag. Required before a decision.",
  get_basket_evidence: "Read basket RSSI, nearest basket and sessions. Required before a decision.",
  get_cart_history: "Read confirmed carts, active sessions and recent resolutions. Required before a decision.",
  get_signal_window: "Read telemetry RSSI around the event to inspect fluctuation or missing samples.",
  get_device_health: "Read heartbeat, reboot, queue backlog and dropped-event evidence.",
  get_lane_state: "Read independently reported switch presence near the event; may be unavailable.",
  get_event_neighbors: "Read nearby same-lane events to investigate bounce or rapid returns.",
  get_camera_evidence: "Read camera observation records if available; no RTSP capture or image analysis.",
  run_evidence_analysis: "Run one allowlisted read-only analysis: " + Object.keys(SCRIPT_DESCRIPTIONS).join(", "),
});

export const AGENT_TOOLS = Object.freeze({
  get_shelf_event: getShelfEvent,
  get_basket_evidence: getBasketEvidence,
  get_cart_history: getCartHistory,
  get_signal_window: getSignalWindow,
  get_device_health: getDeviceHealth,
  get_lane_state: getLaneState,
  get_event_neighbors: getEventNeighbors,
  get_camera_evidence: getCameraEvidence,
  run_evidence_analysis: runEvidenceAnalysis,
});

export function runAgentTool(store, name, parameters = {}) {
  const tool = Object.hasOwn(AGENT_TOOLS, name) ? AGENT_TOOLS[name] : null;
  if (!tool) throw new Error(`Unknown agent tool: ${name}`);
  return tool(store, parameters);
}
