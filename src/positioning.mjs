// Indoor positioning from BLE RSSI. Shelf ESP32s are fixed anchors at known map
// positions; a basket's (x, y) is the point whose distances best match the
// RSSI-derived distances to every anchor that hears it.
//
// RSSI indoors swings by several dB, so results are estimates (typically 1-3 m),
// reported with an error radius. Pure functions here; state lives in createPositioner.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const PATH_LOSS_DEFAULTS = Object.freeze({ txPower: -59, n: 2.2 });
const N_RANGE = [1.4, 4.5];
const TX_RANGE = [-95, -25];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Log-distance path loss: rssi = txPower - 10 n log10(d).
export function rssiToMeters(rssi, model = PATH_LOSS_DEFAULTS) {
  return clamp(10 ** ((model.txPower - rssi) / (10 * model.n)), 0.1, 60);
}

// Fits txPower and n from pairs of (rssi, true distance), e.g. anchor-to-anchor links
// at known map distances. With too little spread it keeps n and fits txPower only.
export function fitPathLoss(samples, fallback = PATH_LOSS_DEFAULTS, { fixedN = null } = {}) {
  const usable = samples.filter((s) => Number.isFinite(s.rssi) && Number.isFinite(s.meters) && s.meters >= 0.3);
  if (fixedN !== null) fallback = { ...fallback, n: fixedN };
  if (!usable.length) return { ...fallback, calibrated: false, samples: 0 };
  if (fixedN !== null) {
    const fitted = usable.reduce((sum, s) => sum + s.rssi + 10 * fixedN * Math.log10(s.meters), 0) / usable.length;
    return { txPower: round1(clamp(fitted, TX_RANGE[0], TX_RANGE[1])), n: fixedN, calibrated: true, samples: usable.length };
  }
  const logs = usable.map((s) => Math.log10(s.meters));
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  const meanRssi = usable.reduce((a, s) => a + s.rssi, 0) / usable.length;
  const spread = Math.sqrt(logs.reduce((a, l) => a + (l - meanLog) ** 2, 0) / logs.length);

  if (usable.length >= 3 && spread >= 0.08) {
    const slope = usable.reduce((a, s, i) => a + (logs[i] - meanLog) * (s.rssi - meanRssi), 0) /
      logs.reduce((a, l) => a + (l - meanLog) ** 2, 0);
    const n = -slope / 10;
    const txPower = meanRssi - slope * meanLog;
    if (n >= N_RANGE[0] && n <= N_RANGE[1] && txPower >= TX_RANGE[0] && txPower <= TX_RANGE[1]) {
      return { txPower: round1(txPower), n: round2(n), calibrated: true, samples: usable.length };
    }
  }
  const txPower = clamp(meanRssi + 10 * fallback.n * meanLog, TX_RANGE[0], TX_RANGE[1]);
  return { txPower: round1(txPower), n: fallback.n, calibrated: true, samples: usable.length };
}

// Weighted least squares (Gauss-Newton). anchors: [{ x, y, meters }] in metres.
// Always returns a point (no NaN when circles do not intersect), clamped to the floor.
export function locate(anchors, floor) {
  const valid = anchors.filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.meters));
  if (valid.length < 2) return null;
  const weight = (a) => 1 / Math.max(0.5, a.meters) ** 2;
  const total = valid.reduce((sum, a) => sum + weight(a), 0);
  let x = valid.reduce((sum, a) => sum + a.x * weight(a), 0) / total;
  let y = valid.reduce((sum, a) => sum + a.y * weight(a), 0) / total;

  if (valid.length === 2) {
    // Only a line is known: place along it by the distance ratio.
    const [a, b] = valid;
    const t = a.meters / (a.meters + b.meters);
    x = a.x + (b.x - a.x) * t;
    y = a.y + (b.y - a.y) * t;
  } else {
    for (let i = 0; i < 25; i += 1) {
      let jxx = 0, jxy = 0, jyy = 0, gx = 0, gy = 0;
      for (const a of valid) {
        const dx = x - a.x, dy = y - a.y;
        const r = Math.max(1e-6, Math.hypot(dx, dy));
        const ux = dx / r, uy = dy / r, residual = r - a.meters, w = weight(a);
        jxx += w * ux * ux; jxy += w * ux * uy; jyy += w * uy * uy;
        gx += w * ux * residual; gy += w * uy * residual;
      }
      const damping = 1e-3 * (jxx + jyy) + 1e-9;
      const det = (jxx + damping) * (jyy + damping) - jxy * jxy;
      if (Math.abs(det) < 1e-12) break;
      const stepX = -((jyy + damping) * gx - jxy * gy) / det;
      const stepY = -((jxx + damping) * gy - jxy * gx) / det;
      x += stepX; y += stepY;
      if (Math.hypot(stepX, stepY) < 1e-4) break;
    }
  }
  x = clamp(x, 0, floor.width);
  y = clamp(y, 0, floor.height);
  const rms = Math.sqrt(valid.reduce((sum, a) => sum + weight(a) * (Math.hypot(x - a.x, y - a.y) - a.meters) ** 2, 0) / total);
  const errorM = clamp(rms + (valid.length === 2 ? 1.5 : 0.6), 0.5, 8);
  return { x, y, errorM };
}

// Relative 2-D placement from pairwise distances (metres). The first three IDs fix the
// frame; later IDs are trilaterated. Returns null when any needed distance is missing.
export function relativePlacement(ids, distance) {
  if (ids.length < 3) return null;
  const [a, b, c] = ids;
  const ab = distance(a, b), ac = distance(a, c), bc = distance(b, c);
  if (![ab, ac, bc].every(Number.isFinite)) return null;
  const placed = new Map([[a, { x: 0, y: 0 }], [b, { x: ab, y: 0 }]]);
  // Law of cosines, with the triangle inequality enforced (noisy distances often break it).
  const cx = clamp((ac * ac - bc * bc + ab * ab) / (2 * ab), -ac, ac);
  placed.set(c, { x: cx, y: Math.sqrt(Math.max(0, ac * ac - cx * cx)) });
  for (const id of ids.slice(3)) {
    const known = [...placed].map(([other, p]) => ({ ...p, meters: distance(id, other) })).filter((p) => Number.isFinite(p.meters));
    const point = locate(known, { width: Infinity, height: Infinity });
    if (!point) return null;
    placed.set(id, { x: point.x, y: point.y });
  }
  return placed;
}

// Rotates/reflects/translates measured points (no scaling) to best match the current
// positions, so auto-placement keeps the store's orientation.
export function alignTo(measured, current) {
  const ids = [...measured.keys()].filter((id) => current.has(id));
  if (ids.length < 2) return measured;
  const mean = (map) => ({
    x: ids.reduce((s, id) => s + map.get(id).x, 0) / ids.length,
    y: ids.reduce((s, id) => s + map.get(id).y, 0) / ids.length,
  });
  const cm = mean(current);
  let best = null;
  for (const flip of [1, -1]) {
    const source = new Map(ids.map((id) => [id, { x: measured.get(id).x, y: flip * measured.get(id).y }]));
    const sm = mean(source);
    let dot = 0, cross = 0;
    for (const id of ids) {
      const p = source.get(id), q = current.get(id);
      const px = p.x - sm.x, py = p.y - sm.y, qx = q.x - cm.x, qy = q.y - cm.y;
      dot += px * qx + py * qy;
      cross += px * qy - py * qx;
    }
    const angle = Math.atan2(cross, dot), cos = Math.cos(angle), sin = Math.sin(angle);
    const transform = (p) => {
      const px = p.x - sm.x, py = flip * p.y - sm.y;
      return { x: cm.x + px * cos - py * sin, y: cm.y + px * sin + py * cos };
    };
    const result = new Map([...measured].map(([id, p]) => [id, transform(p)]));
    const error = ids.reduce((s, id) => s + (result.get(id).x - current.get(id).x) ** 2 + (result.get(id).y - current.get(id).y) ** 2, 0);
    if (!best || error < best.error) best = { error, result };
  }
  return best.result;
}

// Anchor positions in metres from a store layout (shelf zones with a Shelf ID).
export function anchorPositions(layout) {
  const scale = metersPerUnit(layout);
  const anchors = new Map();
  for (const zone of layout.zones) {
    if (zone.kind !== "shelf" || !zone.shelfId) continue;
    const point = zone.anchor ?? { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
    anchors.set(zone.shelfId, { x: point.x * scale, y: point.y * scale });
  }
  return anchors;
}

export function metersPerUnit(layout) {
  return (Number.isFinite(layout.widthM) && layout.widthM > 0 ? layout.widthM : 12) / layout.width;
}

// Proposes ESP32 positions (map units) from anchor-to-anchor RSSI, keeping the store's
// current orientation. Uses an uncalibrated model on purpose: calibrating against the map
// would just copy the map's (possibly wrong) distances back.
export function proposeAnchors(layout, links, model = PATH_LOSS_DEFAULTS) {
  const current = anchorPositions(layout);
  const meters = new Map(links.map((link) => [[link.a, link.b].sort().join("|"), rssiToMeters(link.rssi, model)]));
  const distance = (a, b) => meters.get([a, b].sort().join("|")) ?? NaN;
  // Anchors with the most measured links first; the first three must all hear each other.
  const ids = [...current.keys()].sort((a, b) =>
    [...current.keys()].filter((o) => Number.isFinite(distance(b, o))).length -
    [...current.keys()].filter((o) => Number.isFinite(distance(a, o))).length);
  const usable = ids.filter((id) => ids.some((other) => other !== id && Number.isFinite(distance(id, other))));
  const relative = relativePlacement(usable, distance);
  if (!relative) {
    return { anchors: null, reason: usable.length < 3 ? "ต้องมี ESP32 อย่างน้อย 3 ตัวที่ได้ยินกัน" : "ESP32 บางคู่ยังไม่ได้ยินกัน" };
  }
  const aligned = alignTo(relative, current);
  const scale = metersPerUnit(layout);
  const clampUnits = (value, max) => Math.round(Math.min(max, Math.max(0, value / scale)) * 10) / 10;
  return {
    anchors: Object.fromEntries([...aligned].map(([id, p]) => [id, { x: clampUnits(p.x, layout.width), y: clampUnits(p.y, layout.height) }])),
    distances: links.map((link) => ({ a: link.a, b: link.b, meters: Math.round(distance(link.a, link.b) * 100) / 100 })),
    model,
  };
}

function round1(value) { return Math.round(value * 10) / 10; }
function round2(value) { return Math.round(value * 100) / 100; }

// Keeps the smoothed basket positions between updates.
// Runtime tuning set from the tuning page: basket RSSI at 1 m, a fixed path-loss n, smoothing.
export const TUNING_LIMITS = Object.freeze({ txPower: [-100, -20], n: [1.4, 4.5], alpha: [0.05, 1] });

export function validateTuning(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tuning must be a JSON object");
  const pick = (key, label) => {
    const value = input[key];
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
    const [low, high] = TUNING_LIMITS[key === "basketTxPower" ? "txPower" : key];
    if (value < low || value > high) throw new Error(`${label} must be between ${low} and ${high}`);
    return Math.round(value * 100) / 100;
  };
  return { basketTxPower: pick("basketTxPower", "Basket RSSI at 1 m"), n: pick("n", "Path-loss n"), alpha: pick("alpha", "Smoothing") };
}

export function createPositioner({ basketTxPower = null, basketOffsetDb = 0, alpha = 0.35, moveThresholdM = 0.25, staleMs = 5000, getTuning = () => ({}) } = {}) {
  const positions = new Map(); // basketId -> { xM, yM, errorM, anchors, at }
  let model = { ...PATH_LOSS_DEFAULTS, calibrated: false, samples: 0 };
  let basketModel = { ...PATH_LOSS_DEFAULTS, source: "default" };
  let links = [];

  return {
    // links: [{ a, b, rssi }] (anchor pairs). readings: { A: { "SHELF-01": -60, ... }, ... }.
    update(layout, linkList, readings, t = Date.now()) {
      const anchors = anchorPositions(layout);
      const scale = metersPerUnit(layout);
      const floor = { width: layout.width * scale, height: layout.height * scale };
      links = linkList.filter((link) => anchors.has(link.a) && anchors.has(link.b)).map((link) => {
        const p = anchors.get(link.a), q = anchors.get(link.b);
        return { ...link, mapMeters: Math.hypot(p.x - q.x, p.y - q.y) };
      });
      const tuning = getTuning() ?? {};
      model = fitPathLoss(links.map((link) => ({ rssi: link.rssi, meters: link.mapMeters })), PATH_LOSS_DEFAULTS, { fixedN: tuning.n ?? null });
      basketModel = tuning.basketTxPower != null ? { n: model.n, txPower: tuning.basketTxPower, source: "tuned" }
        : basketTxPower != null ? { n: model.n, txPower: basketTxPower, source: "env" }
          : { n: model.n, txPower: round1(model.txPower + basketOffsetDb), source: model.calibrated ? "anchors" : "default" };
      const smoothing = tuning.alpha ?? alpha;
      let changed = false;

      for (const [basketId, byShelf] of Object.entries(readings)) {
        const heard = Object.entries(byShelf)
          .filter(([shelfId, rssi]) => anchors.has(shelfId) && Number.isFinite(rssi))
          .map(([shelfId, rssi]) => ({ ...anchors.get(shelfId), meters: rssiToMeters(rssi, basketModel) }));
        const point = heard.length >= 2 ? locate(heard, floor) : null;
        const previous = positions.get(basketId);
        if (!point) {
          if (previous && t - previous.at > staleMs) { positions.delete(basketId); changed = true; }
          continue;
        }
        const jump = previous ? Math.hypot(point.x - previous.xM, point.y - previous.yM) : Infinity;
        const a = previous ? (jump > 3 ? smoothing / 2 : smoothing) : 1;
        const next = {
          xM: previous ? previous.xM + (point.x - previous.xM) * a : point.x,
          yM: previous ? previous.yM + (point.y - previous.yM) * a : point.y,
          errorM: previous ? previous.errorM + (point.errorM - previous.errorM) * a : point.errorM,
          anchors: heard.length,
          at: t,
        };
        if (!previous || Math.hypot(next.xM - previous.lastSentX, next.yM - previous.lastSentY) >= moveThresholdM ||
            previous.anchors !== next.anchors) {
          next.lastSentX = next.xM; next.lastSentY = next.yM; changed = true;
        } else {
          next.lastSentX = previous.lastSentX; next.lastSentY = previous.lastSentY;
        }
        positions.set(basketId, next);
      }
      for (const [basketId, position] of positions) {
        if (!(basketId in readings) && t - position.at > staleMs) { positions.delete(basketId); changed = true; }
      }
      return changed;
    },

    snapshot(layout) {
      const scale = metersPerUnit(layout);
      return {
        model: { txPower: model.txPower, n: model.n, calibrated: model.calibrated, samples: model.samples },
        basketModel: { txPower: basketModel.txPower, n: basketModel.n, source: basketModel.source },
        tuning: { basketTxPower: null, n: null, alpha: null, ...(getTuning() ?? {}) },
        links: links.map((link) => ({
          a: link.a, b: link.b, rssi: link.rssi,
          rssiMeters: Math.round(rssiToMeters(link.rssi, model) * 100) / 100,
          mapMeters: Math.round(link.mapMeters * 100) / 100,
        })),
        positions: Object.fromEntries([...positions].map(([basketId, p]) => [basketId, {
          x: Math.round((p.xM / scale) * 10) / 10,
          y: Math.round((p.yM / scale) * 10) / 10,
          radius: Math.round((p.errorM / scale) * 10) / 10,
          xM: Math.round(p.xM * 100) / 100,
          yM: Math.round(p.yM * 100) / 100,
          errorM: Math.round(p.errorM * 100) / 100,
          anchors: p.anchors,
        }])),
      };
    },
  };
}

// Tuning values saved next to the demo state (data/positioning-tuning.json).
export function createTuningStore({ path, log = console.error }) {
  let current = validateTuning({});
  return {
    async load() {
      try { current = validateTuning(JSON.parse(await readFile(path, "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") log("Positioning tuning file ignored: " + error.message); current = validateTuning({}); }
      return current;
    },
    get() { return current; },
    async save(input) {
      const next = validateTuning(input);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path + ".tmp", JSON.stringify(next, null, 2), "utf8");
      await rename(path + ".tmp", path);
      current = next;
      return current;
    },
    async reset() {
      await rm(path, { force: true });
      current = validateTuning({});
      return current;
    },
  };
}
