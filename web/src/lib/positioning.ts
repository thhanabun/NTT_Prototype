// Browser copy of the anchor-geometry helpers in src/positioning.mjs (covered by
// tests/positioning.test.mjs). Keep the two in step.

export type Point = { x: number; y: number };

export function rssiToMeters(rssi: number, model: { txPower: number; n: number }) {
  return Math.min(60, Math.max(0.1, 10 ** ((model.txPower - rssi) / (10 * model.n))));
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Places points from pairwise distances: the first id at the origin, the second on +x.
// Extra ids are trilaterated from the ones already placed. Null if a needed distance is missing.
export function relativePlacement(ids: string[], distance: (a: string, b: string) => number): Map<string, Point> | null {
  if (ids.length < 2) return null;
  const [a, b] = ids;
  const ab = distance(a, b);
  if (!Number.isFinite(ab)) return null;
  const placed = new Map<string, Point>([[a, { x: 0, y: 0 }], [b, { x: ab, y: 0 }]]);
  if (ids.length === 2) return placed;
  const c = ids[2];
  const ac = distance(a, c), bc = distance(b, c);
  if (!Number.isFinite(ac) || !Number.isFinite(bc)) return null;
  const cx = clamp((ac * ac - bc * bc + ab * ab) / (2 * ab), -ac, ac);
  placed.set(c, { x: cx, y: Math.sqrt(Math.max(0, ac * ac - cx * cx)) });
  for (const id of ids.slice(3)) {
    const known = [...placed].map(([other, p]) => ({ ...p, meters: distance(id, other) })).filter((p) => Number.isFinite(p.meters));
    if (known.length < 2) return null;
    // Gauss-Newton from the weighted centroid (same as the server's locate()).
    const weight = (p: { meters: number }) => 1 / Math.max(0.5, p.meters) ** 2;
    const total = known.reduce((s, p) => s + weight(p), 0);
    let x = known.reduce((s, p) => s + p.x * weight(p), 0) / total;
    let y = known.reduce((s, p) => s + p.y * weight(p), 0) / total;
    for (let i = 0; i < 25; i += 1) {
      let jxx = 0, jxy = 0, jyy = 0, gx = 0, gy = 0;
      for (const p of known) {
        const dx = x - p.x, dy = y - p.y, r = Math.max(1e-6, Math.hypot(dx, dy));
        const ux = dx / r, uy = dy / r, res = r - p.meters, w = weight(p);
        jxx += w * ux * ux; jxy += w * ux * uy; jyy += w * uy * uy; gx += w * ux * res; gy += w * uy * res;
      }
      const damping = 1e-3 * (jxx + jyy) + 1e-9;
      const det = (jxx + damping) * (jyy + damping) - jxy * jxy;
      if (Math.abs(det) < 1e-12) break;
      const sx = -((jyy + damping) * gx - jxy * gy) / det, sy = -((jxx + damping) * gy - jxy * gx) / det;
      x += sx; y += sy;
      if (Math.hypot(sx, sy) < 1e-4) break;
    }
    placed.set(id, { x, y });
  }
  return placed;
}

// Rotates/mirrors/translates measured points (no scaling) onto the reference points.
export function alignTo(measured: Map<string, Point>, reference: Map<string, Point>): Map<string, Point> {
  const ids = [...measured.keys()].filter((id) => reference.has(id));
  if (ids.length < 2) return measured;
  const mean = (map: Map<string, Point>) => ({
    x: ids.reduce((s, id) => s + map.get(id)!.x, 0) / ids.length,
    y: ids.reduce((s, id) => s + map.get(id)!.y, 0) / ids.length,
  });
  const cr = mean(reference);
  let best: { error: number; result: Map<string, Point> } | null = null;
  for (const flip of [1, -1]) {
    const source = new Map(ids.map((id) => [id, { x: measured.get(id)!.x, y: flip * measured.get(id)!.y }]));
    const cs = mean(source);
    let dot = 0, cross = 0;
    for (const id of ids) {
      const p = source.get(id)!, q = reference.get(id)!;
      const px = p.x - cs.x, py = p.y - cs.y, qx = q.x - cr.x, qy = q.y - cr.y;
      dot += px * qx + py * qy;
      cross += px * qy - py * qx;
    }
    const angle = Math.atan2(cross, dot), cos = Math.cos(angle), sin = Math.sin(angle);
    const result = new Map([...measured].map(([id, p]) => {
      const px = p.x - cs.x, py = flip * p.y - cs.y;
      return [id, { x: cr.x + px * cos - py * sin, y: cr.y + px * sin + py * cos }];
    }));
    const error = ids.reduce((s, id) => s + (result.get(id)!.x - reference.get(id)!.x) ** 2 + (result.get(id)!.y - reference.get(id)!.y) ** 2, 0);
    if (!best || error < best.error) best = { error, result };
  }
  return best!.result;
}

// Fits RSSI@1m (and n when distances vary enough) from pairs with tape-measured distances.
// Same rules as fitPathLoss in src/positioning.mjs.
export function fitScale(samples: { rssi: number; meters: number }[], fallbackN: number) {
  const usable = samples.filter((s) => Number.isFinite(s.rssi) && Number.isFinite(s.meters) && s.meters >= 0.2);
  if (!usable.length) return null;
  const logs = usable.map((s) => Math.log10(s.meters));
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  const meanRssi = usable.reduce((a, s) => a + s.rssi, 0) / usable.length;
  const spread = Math.sqrt(logs.reduce((a, l) => a + (l - meanLog) ** 2, 0) / logs.length);
  let n = fallbackN;
  let txPower = meanRssi + 10 * n * meanLog;
  let fittedN = false;
  if (usable.length >= 2 && spread >= 0.08) {
    const slope = usable.reduce((a, s, i) => a + (logs[i] - meanLog) * (s.rssi - meanRssi), 0) / logs.reduce((a, l) => a + (l - meanLog) ** 2, 0);
    const candidate = -slope / 10;
    if (candidate >= 1.4 && candidate <= 4.5) { n = candidate; txPower = meanRssi - slope * meanLog; fittedN = true; }
  }
  const model = { txPower: Math.round(txPower * 10) / 10, n: Math.round(n * 100) / 100 };
  const errors = usable.map((s) => rssiToMeters(s.rssi, model) - s.meters);
  return { ...model, fittedN, pairs: usable.length, rmsErrorM: Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length) };
}
