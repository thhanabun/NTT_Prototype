import { deviceState } from "./device-state.mjs";

export const SHELF_IDS = ["SHELF-01", "SHELF-02", "SHELF-03"];

export function shelfStates(store, now = Date.now()) {
  return SHELF_IDS.map((shelfId, index) => {
    const event = store.events.find(item => item.shelfId === shelfId);
    const item = event && store.cases.find(item => item.eventId === event.eventId);
    const device = deviceState(store, now, shelfId);
    const fsmState = !event ? "IDLE" : !item ? "CART_UPDATED" : item.status === "CLOSED" ? "CASE_CLOSED"
      : item.agent?.status === "RUNNING" ? "AGENT_INVESTIGATING" : item.status === "WAITING_CUSTOMER" ? "WAITING_CUSTOMER" : "WAITING_STAFF";
    return {
      shelfId, label: `Shelf ${index + 1}`, enabled: true,
      status: device.status,
      lastSeenAt: event?.receivedAt ?? null,
      lastEventId: event?.eventId ?? null,
      fsmState,
      rssi: event?.rssi ?? { A: null, B: null },
      device,
    };
  });
}
