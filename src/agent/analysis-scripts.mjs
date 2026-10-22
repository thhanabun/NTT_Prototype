function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const ANALYSIS_SCRIPTS = Object.freeze({
  rssi_stability({ signal }) {
    if (signal.samples.length < 3) return { status: "INSUFFICIENT_DATA", issue: null, sampleCount: signal.samples.length };
    const readings = Object.fromEntries(["A", "B"].map(id => {
      const values = signal.samples.map(sample => sample.rssi[id]).filter(Number.isFinite);
      return [id, { samples: values.length, median: median(values), rangeDb: values.length ? Math.max(...values) - Math.min(...values) : null }];
    }));
    const winners = signal.samples.filter(sample => Number.isFinite(sample.rssi.A) && Number.isFinite(sample.rssi.B) && sample.rssi.A !== sample.rssi.B)
      .map(sample => sample.rssi.A > sample.rssi.B ? "A" : "B");
    const flips = winners.slice(1).filter((winner, i) => winner !== winners[i]).length;
    const insufficient = Object.values(readings).some(reading => reading.samples < 3);
    const unstable = flips > 0 || Object.values(readings).some(reading => reading.rangeDb > 12);
    return { status: insufficient ? "INSUFFICIENT_DATA" : unstable ? "CONFLICT" : "CONSISTENT", issue: unstable ? "RSSI lead changes or fluctuates across the event window" : null, readings, leadFlips: flips };
  },
  switch_bounce({ event, neighbors, lane }) {
    const nearEdges = neighbors.events.filter(item => item.eventId !== event.eventId && Math.abs(Date.parse(item.receivedAt) - Date.parse(event.receivedAt)) <= 160);
    const expectedPresent = event.eventType === "PUT_BACK";
    const afterEvent = lane.status === "AVAILABLE" && lane.sample.timeBasis === "SOURCE_TIMESTAMP" && event.timeBasis === "SOURCE_TIMESTAMP" && Date.parse(lane.sample.capturedAt) >= Date.parse(event.timestamp);
    const mismatch = afterEvent && lane.sample.present !== expectedPresent;
    return { status: nearEdges.length || mismatch ? "CONFLICT" : afterEvent ? "CONSISTENT" : "INSUFFICIENT_DATA", issue: nearEdges.length ? "Multiple received lane events within 160 ms; inspect possible bounce or transport batching" : mismatch ? "Lane presence contradicts the shelf event" : null, nearbyEdgeCount: nearEdges.length };
  },
  cart_consistency({ event, history }) {
    const baskets = history.baskets.map(basket => ({ basketId: basket.basketId, activeSession: Boolean(basket.activeSession), quantity: basket.cart.find(line => line.sku === event.sku)?.quantity || 0 }));
    return { status: "AVAILABLE", eventType: event.eventType, baskets, validTargets: baskets.filter(basket => basket.activeSession && (event.eventType === "PICK" || basket.quantity > 0)).map(basket => basket.basketId) };
  },
});

export const SCRIPT_DESCRIPTIONS = Object.freeze({
  rssi_stability: "Analyze RSSI sample coverage, variation and changes of nearest basket.",
  switch_bounce: "Analyze rapid lane events and contradictory switch presence.",
  cart_consistency: "Check active sessions and confirmed quantities for PICK/PUT_BACK.",
});
