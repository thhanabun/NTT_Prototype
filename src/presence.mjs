// Store-map presence: which shelf each basket is near, from shelf ESP32 RSSI reports.
// In memory only. It never touches carts, checkout, cases or the audit log.
// RSSI is proximity evidence, so the result is a shelf zone, not an (x, y) position.

export const BASKET_IDS = ["A", "B"];
const SHELF_ID_PATTERN = /^[A-Z0-9-]{1,32}$/;

export const PRESENCE_DEFAULTS = Object.freeze({
  enterDbm: -70,       // a basket enters a shelf zone at this RSSI or stronger
  exitDbm: -80,        // and stays until RSSI drops below this (hysteresis)
  switchMarginDb: 6,   // another shelf must be this much stronger to take over
  staleMs: 4000,       // readings and shelves older than this are ignored
  pickHoldMs: 8000,    // a confirmed pick pins the basket to that shelf this long
  maxShelves: 16,
});

function normalizeRssi(value) {
  return Number.isFinite(value) && value >= -127 && value <= 0 ? value : null;
}

function normalizeAge(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 60_000) : 0;
}

export function presenceConfigFromEnv(env = process.env) {
  const read = (name, fallback) => {
    const value = Number(env[name]);
    return env[name] !== undefined && Number.isFinite(value) ? value : fallback;
  };
  return {
    enterDbm: read("PRESENCE_ENTER_DBM", PRESENCE_DEFAULTS.enterDbm),
    exitDbm: read("PRESENCE_EXIT_DBM", PRESENCE_DEFAULTS.exitDbm),
    switchMarginDb: read("PRESENCE_SWITCH_MARGIN_DB", PRESENCE_DEFAULTS.switchMarginDb),
    staleMs: read("PRESENCE_STALE_MS", PRESENCE_DEFAULTS.staleMs),
    pickHoldMs: read("PRESENCE_PICK_HOLD_MS", PRESENCE_DEFAULTS.pickHoldMs),
  };
}

export function createPresenceTracker(options = {}) {
  const { now = Date.now, ...overrides } = options;
  const config = { ...PRESENCE_DEFAULTS, ...overrides };
  // shelfId -> { lastReportAt, online, readings: { A: { rssi, at } | null, B: ... } }
  const shelves = new Map();
  const baskets = Object.fromEntries(BASKET_IDS.map((id) => [id, {
    zone: null, since: null, source: null, holdUntil: 0,
  }]));
  // Anchor-to-anchor RSSI, "SHELF-01>SHELF-02" -> { rssi (smoothed), at }. ESP32s do not move,
  // so these are kept longer and averaged; they calibrate distance and auto-place anchors.
  const anchorLinks = new Map();
  const linkStaleMs = Math.max(config.staleMs * 4, 15_000);

  const freshReading = (shelf, basketId, t) => {
    const reading = shelf.readings[basketId];
    return reading && t - reading.at <= config.staleMs ? reading : null;
  };

  function decideZone(basketId, t) {
    const basket = baskets[basketId];
    if (basket.holdUntil > t) return basket.zone;

    let best = null;
    let current = null;
    for (const [shelfId, shelf] of shelves) {
      const reading = freshReading(shelf, basketId, t);
      if (!reading) continue;
      if (!best || reading.rssi > best.rssi) best = { shelfId, rssi: reading.rssi };
      if (shelfId === basket.zone) current = reading;
    }

    if (current && current.rssi >= config.exitDbm) {
      const takesOver = best && best.shelfId !== basket.zone &&
        best.rssi >= config.enterDbm && best.rssi - current.rssi >= config.switchMarginDb;
      return takesOver ? best.shelfId : basket.zone;
    }
    return best && best.rssi >= config.enterDbm ? best.shelfId : null;
  }

  // Re-evaluates every basket and shelf; true when anything the map shows has changed.
  function evaluate(t) {
    let changed = false;
    for (const shelf of shelves.values()) {
      const online = t - shelf.lastReportAt <= config.staleMs;
      if (online !== shelf.online) { shelf.online = online; changed = true; }
    }
    for (const basketId of BASKET_IDS) {
      const basket = baskets[basketId];
      if (basket.holdUntil && basket.holdUntil <= t) {
        basket.holdUntil = 0;
        basket.source = basket.zone ? "RSSI" : null;
      }
      const zone = decideZone(basketId, t);
      if (zone !== basket.zone) {
        basket.zone = zone;
        basket.since = zone ? new Date(t).toISOString() : null;
        basket.source = zone ? "RSSI" : null;
        changed = true;
      }
    }
    return changed;
  }

  return {
    config,

    ingest(report) {
      if (!report || typeof report !== "object" || Array.isArray(report)) {
        throw new Error("Presence report must be a JSON object");
      }
      const shelfId = String(report.shelfId || "").toUpperCase();
      if (!SHELF_ID_PATTERN.test(shelfId)) throw new Error("Presence report needs a valid shelfId");
      if (!shelves.has(shelfId) && shelves.size >= config.maxShelves) {
        throw new Error("Too many shelves reporting presence");
      }
      const t = now();
      const rssi = report.rssi && typeof report.rssi === "object" ? report.rssi : {};
      const ages = report.ageMs && typeof report.ageMs === "object" ? report.ageMs : {};
      const shelf = shelves.get(shelfId) || { lastReportAt: t, online: false, readings: {} };
      shelf.lastReportAt = t;
      for (const basketId of BASKET_IDS) {
        const value = normalizeRssi(rssi[basketId]);
        shelf.readings[basketId] = value === null ? null : { rssi: value, at: t - normalizeAge(ages[basketId]) };
      }
      shelves.set(shelfId, shelf);
      const heard = report.anchors && typeof report.anchors === "object" && !Array.isArray(report.anchors) ? report.anchors : {};
      for (const [rawOther, rawRssi] of Object.entries(heard).slice(0, config.maxShelves)) {
        const other = String(rawOther).toUpperCase();
        const value = normalizeRssi(rawRssi);
        if (!SHELF_ID_PATTERN.test(other) || other === shelfId || value === null) continue;
        const key = `${shelfId}>${other}`;
        const previous = anchorLinks.get(key);
        const fresh = previous && t - previous.at <= linkStaleMs;
        anchorLinks.set(key, { rssi: fresh ? previous.rssi + (value - previous.rssi) * 0.5 : value, at: t });
      }
      return { changed: evaluate(t) };
    },

    // Undirected anchor links with both directions averaged: [{ a, b, rssi }].
    links() {
      const t = now();
      const pairs = new Map();
      for (const [key, link] of anchorLinks) {
        if (t - link.at > linkStaleMs) continue;
        const [from, to] = key.split(">");
        const [a, b] = from < to ? [from, to] : [to, from];
        const pair = pairs.get(`${a}|${b}`) ?? { a, b, sum: 0, count: 0 };
        pair.sum += link.rssi; pair.count += 1;
        pairs.set(`${a}|${b}`, pair);
      }
      return [...pairs.values()].map(({ a, b, sum, count }) => ({ a, b, rssi: Math.round((sum / count) * 10) / 10, directions: count }));
    },

    // Fresh basket RSSI per shelf for positioning: { A: { "SHELF-01": -60 }, B: {} }.
    basketReadings() {
      const t = now();
      return Object.fromEntries(BASKET_IDS.map((basketId) => [basketId, Object.fromEntries(
        [...shelves].map(([shelfId, shelf]) => [shelfId, freshReading(shelf, basketId, t)?.rssi])
          .filter(([, rssi]) => rssi !== undefined),
      )]));
    },

    // A switch-confirmed pick (clear RSSI lead) is the strongest location evidence we have.
    confirmPick(basketId, shelfId) {
      const basket = baskets[String(basketId || "").toUpperCase()];
      const shelf = String(shelfId || "").toUpperCase();
      if (!basket || !SHELF_ID_PATTERN.test(shelf)) return false;
      const t = now();
      const changed = basket.zone !== shelf || basket.source !== "PICK";
      if (basket.zone !== shelf) basket.since = new Date(t).toISOString();
      basket.zone = shelf;
      basket.source = "PICK";
      basket.holdUntil = t + config.pickHoldMs;
      return changed;
    },

    tick() {
      return evaluate(now());
    },

    snapshot() {
      const t = now();
      return {
        updatedAt: new Date(t).toISOString(),
        thresholds: { enterDbm: config.enterDbm, exitDbm: config.exitDbm, staleMs: config.staleMs },
        baskets: BASKET_IDS.map((basketId) => {
          const basket = baskets[basketId];
          const rssi = {};
          for (const [shelfId, shelf] of shelves) {
            rssi[shelfId] = freshReading(shelf, basketId, t)?.rssi ?? null;
          }
          return { basketId, zone: basket.zone, since: basket.since, source: basket.source, rssi };
        }),
        shelves: [...shelves].map(([shelfId, shelf]) => ({
          shelfId,
          lastReportAt: new Date(shelf.lastReportAt).toISOString(),
          online: t - shelf.lastReportAt <= config.staleMs,
        })),
      };
    },
  };
}
