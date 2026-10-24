export const RSSI_CLEAR_MARGIN_DB = 10;
export const SINGLE_BASKET_MIN_RSSI = Number(process.env.SINGLE_BASKET_MIN_RSSI ?? -80);
if (!Number.isFinite(SINGLE_BASKET_MIN_RSSI) || SINGLE_BASKET_MIN_RSSI < -127 || SINGLE_BASKET_MIN_RSSI > 0) {
  throw new Error("SINGLE_BASKET_MIN_RSSI must be between -127 and 0 dBm");
}

export function assessProximity(rssi = {}, activeSessions = {}) {
  const seen = ["A", "B"].filter(id => Number.isFinite(rssi[id]));
  if (seen.length === 2) {
    const marginDb = Math.abs(rssi.A - rssi.B);
    return {
      zone: marginDb >= RSSI_CLEAR_MARGIN_DB ? "CLEAR" : "AMBIGUOUS",
      candidate: rssi.A === rssi.B ? null : rssi.A > rssi.B ? "A" : "B",
      marginDb, selectionBasis: "RSSI_MARGIN",
    };
  }
  const active = ["A", "B"].filter(id => activeSessions[id]);
  if (seen.length === 1 && active.length === 1 && seen[0] === active[0] && rssi[seen[0]] >= SINGLE_BASKET_MIN_RSSI) {
    return { zone: "CLEAR", candidate: seen[0], marginDb: null, selectionBasis: "SINGLE_ACTIVE_BASKET" };
  }
  return { zone: "ZONE_UNKNOWN", candidate: null, marginDb: null, selectionBasis: "INSUFFICIENT_EVIDENCE" };
}
