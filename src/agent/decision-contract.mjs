// Full cart histories can truncate the sensor evidence, so bound the model input.
export function basketDecisionState(context) {
  const { event = {}, evidence = {}, history = {} } = context;
  return {
    event: { eventType: event.eventType, sku: event.sku, delayed: event.delayed === true },
    evidence: {
      rssi: evidence.rssi,
      marginDb: evidence.marginDb,
      nearestBasket: evidence.candidate ?? null,
      zone: evidence.zone,
      activeSessions: evidence.activeSessions,
    },
    confirmedQuantity: Object.fromEntries(["A", "B"].map((id) => [
      id,
      history.baskets?.find((basket) => basket.basketId === id)?.cart
        ?.find((line) => line.sku === event.sku)?.quantity || 0,
    ])),
    ...(context.investigation ? { investigation: context.investigation.slice(-8) } : {}),
  };
}

export const BASKET_DECISION_QUESTION = Object.freeze({
  type: "choice",
  instructions: "Which basket should be asked to confirm this shelf event? BLE indicates proximity, not identity. Prefer NONE for tied, missing, delayed or conflicting evidence. A valid suggestion still requires human confirmation.",
  criteria: {
    A: "Basket A is the nearest basket, has an active session, and the event evidence supports asking its customer.",
    B: "Basket B is the nearest basket, has an active session, and the event evidence supports asking its customer.",
    NONE: "No basket is supported: the readings tie, evidence is missing or stale, the session is missing, or a PUT_BACK has no confirmed item.",
  },
});
