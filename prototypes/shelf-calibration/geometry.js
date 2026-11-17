// Shared maths for the store-map page (copied unchanged from the tested v1 page).
const fitH = (src, dst) => { // least-squares homography src -> dst (h8 = 1)
  const A = Array.from({ length: 8 }, () => Array(9).fill(0));
  src.forEach(([x, y], i) => { const [u, v] = dst[i];
    for (const [r, b] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]])
      for (let a = 0; a < 8; a++) { for (let j = 0; j < 8; j++) A[a][j] += r[a] * r[j]; A[a][8] += r[a] * b; } });
  for (let c = 0; c < 8; c++) { let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c]; if (Math.abs(d) < 1e-12) throw new Error("mapping cannot be computed");
    A[c] = A[c].map(v => v / d); for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c]; A[r] = A[r].map((v, k) => v - f * A[c][k]); } }
  return [...A.map(r => r[8]), 1];
};
const proj = (h, [x, y]) => { const d = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d]; };
const inv = h => { const [a, b, c, d, e, f, g, i, j] = h, det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  return [e * j - f * i, c * i - b * j, b * f - c * e, f * g - d * j, a * j - c * g, c * d - a * f, d * i - e * g, b * g - a * i, a * e - b * d].map(v => v / det); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const turn = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const mean = pts => pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
const inside = (p, poly) => poly.reduce((hit, a, i) => { const b = poly[(i + poly.length - 1) % poly.length];
  return (a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] ? !hit : hit; }, false);
// Rectangle (centre, length along the front edge, depth, angle) for floor corners: front-left, front-right, back-right, back-left.
const rectOf = ([a, b, c, d]) => ({ cx: (a[0] + b[0] + c[0] + d[0]) / 4, cy: (a[1] + b[1] + c[1] + d[1]) / 4,
  len: (dist(a, b) + dist(d, c)) / 2, dep: (dist(a, d) + dist(b, c)) / 2, ang: Math.atan2(b[1] - a[1] + c[1] - d[1], b[0] - a[0] + c[0] - d[0]) });
const rectCorners = r => [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => { const [x, y] = turn([sx * r.len / 2, sy * r.dep / 2], r.ang); return [r.cx + x, r.cy + y]; });

function ordered(pts) {
  const c = mean(pts), ring = [...pts].sort((a, b) => Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]));
  // Front edge: at the corner nearest the camera (lowest in the picture), the flatter of its two edges.
  // (Side edges go into depth and look steeper in perspective; "the two lowest corners" can pick the side by a few px.)
  const b = ring.reduce((best, p, i) => p[1] > ring[best][1] ? i : best, 0), next = ring[(b + 1) % 4], prev = ring[(b + 3) % 4];
  const slope = q => Math.abs(q[1] - ring[b][1]) / Math.max(1e-6, Math.abs(q[0] - ring[b][0]));
  const start = slope(next) <= slope(prev) ? b : (b + 3) % 4; // ring runs left -> right along the front
  return [0, 1, 2, 3].map(i => ring[(start + i) % 4]);
}

const ringOrder = pts => { const c = mean(pts); return [...pts].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0])); };
const mul3 = (A, B) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
function lsq(A, b) { // least squares via normal equations, Gauss-Jordan with pivoting
  const n = A[0].length, M = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => A.reduce((t, r) => t + r[i] * r[j], 0)), A.reduce((t, r, k) => t + r[i] * b[k], 0)]);
  for (let c = 0; c < n; c++) { let q = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[q][c])) q = r; [M[c], M[q]] = [M[q], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / r[i]);
}
// Image -> map homography from points (x -> X) and points lying on map lines (x on line a-b). Linear; reweighted so errors count in metres.
function fitMixed(P, Ls, size) {
  const S = size, N = [1 / S, 0, -.5, 0, 1 / S, -.5, 0, 0, 1], nrm = x => [x[0] / S - .5, x[1] / S - .5];
  let g = null;
  for (let it = 0; it < 4; it++) { const A = [], b = [], w = x => g ? 1 / Math.max(1e-6, Math.abs(g[6] * x[0] + g[7] * x[1] + 1)) : 1;
    for (const { x, X, w: wt } of P) { const [u, v] = nrm(x), k = w([u, v]) * (wt ?? 1);
      A.push([u, v, 1, 0, 0, 0, -X[0] * u, -X[0] * v].map(c => c * k)); b.push(X[0] * k);
      A.push([0, 0, 0, u, v, 1, -X[1] * u, -X[1] * v].map(c => c * k)); b.push(X[1] * k); }
    for (const { x, a, b: q, w: wt } of Ls) { const [u, v] = nrm(x), k = w([u, v]) * (wt ?? 1), len = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1, nx = -(q[1] - a[1]) / len, ny = (q[0] - a[0]) / len, d = nx * a[0] + ny * a[1];
      A.push([nx * u, nx * v, nx, ny * u, ny * v, ny, -d * u, -d * v].map(c => c * k)); b.push(d * k); }
    const sol = lsq(A, b); if (!sol) return null; g = [...sol, 1]; }
  const H = mul3(g, N); return H.map(v => v / H[8]);
}
const detJ = (H, x) => { const a = proj(H, x), b = proj(H, [x[0] + 1, x[1]]), c = proj(H, [x[0], x[1] + 1]); return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); };
const lineDist = (m, a, b) => { // distance to the edge itself, not its extension: a point seen on an edge lies between its ends
  const d = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((m[0] - a[0]) * d[0] + (m[1] - a[1]) * d[1]) / ((d[0] ** 2 + d[1] ** 2) || 1)));
  return dist(m, [a[0] + t * d[0], a[1] + t * d[1]]); };
// A real camera has 7 unknowns (focal length, where it is incl. height, which way it looks), not the 8 of any 4-point mapping.
// Fitting that model needs fewer clues and cannot give bent or upside-down views. Started from the 8-unknown solution.
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const rotOf = w => { const th = Math.hypot(...w); if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]; const [x, y, z] = w.map(v => v / th), c = Math.cos(th), sn = Math.sin(th), C = 1 - c;
  return [c + x * x * C, x * y * C - z * sn, x * z * C + y * sn, y * x * C + z * sn, c + y * y * C, y * z * C - x * sn, z * x * C - y * sn, z * y * C + x * sn, c + z * z * C]; };
const vecOf = R => { const c = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)), th = Math.acos(c); if (th < 1e-9) return [0, 0, 0];
  const k = th / (2 * Math.sin(th)); return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k]; };
function cameraFit(Hlin, P, Ls, W, Hh, pp = null) {
  const [u0, v0] = pp ?? [W / 2, Hh / 2], G = inv(Hlin), gc = [G[0] - u0 * G[6], G[1] - u0 * G[7], G[2] - u0 * G[8], G[3] - v0 * G[6], G[4] - v0 * G[7], G[5] - v0 * G[8], G[6], G[7], G[8]];
  let f2 = -(gc[0] * gc[1] + gc[3] * gc[4]) / (gc[6] * gc[7]);
  if (!(f2 > 0)) f2 = (gc[1] ** 2 + gc[4] ** 2 - gc[0] ** 2 - gc[3] ** 2) / (gc[6] ** 2 - gc[7] ** 2);
  let f = f2 > 0 && isFinite(f2) ? Math.sqrt(f2) : W; f = Math.min(5 * W, Math.max(.3 * W, f));
  let m1 = [gc[0] / f, gc[3] / f, gc[6]], m2 = [gc[1] / f, gc[4] / f, gc[7]], m3 = [gc[2] / f, gc[5] / f, gc[8]];
  const lam = (Math.hypot(...m1) + Math.hypot(...m2)) / 2 * ((X0 => X0 && (m1[2] * X0[0] + m2[2] * X0[1] + m3[2]) < 0 ? -1 : 1)(P[0]?.X ?? Ls[0]?.a));
  m1 = m1.map(v => v / lam); m2 = m2.map(v => v / lam); const t0 = m3.map(v => v / lam);
  const r1 = norm3(m1), r2 = norm3(m2.map((v, i) => v - (r1[0] * m2[0] + r1[1] * m2[1] + r1[2] * m2[2]) * r1[i])), r3 = cross(r1, r2);
  const R0 = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
  const Gof = q => { const R = rotOf(q.slice(0, 3)), fq = Math.exp(q[6]);
    return [fq * R[0] + u0 * R[6], fq * R[1] + u0 * R[7], fq * q[3] + u0 * q[5], fq * R[3] + v0 * R[6], fq * R[4] + v0 * R[7], fq * q[4] + v0 * q[5], R[6], R[7], q[5]]; };
  const seg = (m, a, b) => lineDist(m, a, b);
  const resid = q => { const Gq = Gof(q), out = [];
    for (const o of P) { const m = proj(Gq, o.X), wt = o.w ?? 1; out.push((m[0] - o.x[0]) * wt, (m[1] - o.x[1]) * wt); }
    for (const o of Ls) out.push(seg(o.x, proj(Gq, o.a), proj(Gq, o.b)) * (o.w ?? 1));
    return out; };
  let q = [...vecOf(R0), ...t0, Math.log(f)], r = resid(q), cost = r.reduce((a, v) => a + v * v, 0), lambda = 1e-3;
  for (let it = 0; it < 60; it++) {
    const J = q.map((v, k) => { const e = 1e-6 * (1 + Math.abs(v)), qq = [...q]; qq[k] += e; return resid(qq).map((x, i) => (x - r[i]) / e); });
    const n = q.length, A = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => J[i].reduce((a, x, t) => a + x * J[j][t], 0) * (i === j ? 1 + lambda : 1)), -J[i].reduce((a, x, t) => a + x * r[t], 0)]);
    for (let c = 0; c < n; c++) { let pv = c; for (let rr = c + 1; rr < n; rr++) if (Math.abs(A[rr][c]) > Math.abs(A[pv][c])) pv = rr; [A[c], A[pv]] = [A[pv], A[c]];
      for (let rr = 0; rr < n; rr++) if (rr !== c && A[c][c]) { const fct = A[rr][c] / A[c][c]; for (let k = c; k <= n; k++) A[rr][k] -= fct * A[c][k]; } }
    const trial = q.map((v, i) => v + (A[i][i] ? A[i][n] / A[i][i] : 0)), rt = resid(trial), ct = rt.reduce((a, v) => a + v * v, 0);
    if (isFinite(ct) && ct < cost) { const done = cost - ct < 1e-10 * (1 + cost); q = trial; r = rt; cost = ct; lambda = Math.max(1e-9, lambda / 3); if (done) break; } else lambda *= 4;
  }
  const Gq = Gof(q), fq = Math.exp(q[6]), Rq = rotOf(q.slice(0, 3)), C = [0, 1, 2].map(i => -(Rq[i] * q[3] + Rq[3 + i] * q[4] + Rq[6 + i] * q[5]));
  if (!(fq > .2 * W && fq < 8 * W)) return null;
  if ([...P.map(o => o.X), ...Ls.flatMap(o => [o.a, o.b])].some(X => Rq[6] * X[0] + Rq[7] * X[1] + q[5] <= 0)) return null; // everything in front of the camera
  const Hq = inv(Gq); return { H: Hq.map(v => v / Hq[8]), f: fq, height: Math.abs(C[2]), pos: [C[0], C[1]], pxRms: Math.sqrt(cost / Math.max(1, r.length)) };
}

const LINK_M = 1.0, LINK_MS = 2000, PREDICT_MS = 1500, MAX_SPEED = 2.0;
// Clothing colour (server "look"): re-finds a person after occlusion or leaving and coming back (up to REID_MS),
// and stops two different-looking people near each other from being joined.
const REID_MS = 30000, LOOK_SAME = .75, LOOK_DIFF = .1;
// Appearance on one 0..1 scale ("looks alike"): from the re-ID vector when both sides have one (cosine: different people ~0.2,
// same person ~0.6 across cameras on B1-01 truth), else from clothing colour (different ~0.65, same ~0.9).
const appSim = (q, p) => { if (window.noLook) return null;
  if (q.emb && p.emb) { let s = 0; for (let i = 0; i < q.emb.length; i++) s += q.emb[i] * p.emb[i]; return Math.max(0, Math.min(1, (s - .2) / .4)); }
  const h = lookSim(q.look, p.look); return h === null ? null : Math.max(0, Math.min(1, (h - .65) / .25)); };
const embMix = (a, b, w) => { if (!a) return b; if (!b) return a; const v = a.map((x, i) => (1 - w) * x + w * b[i]), n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const lookSim = (a, b) => { if (window.noLook || !a || !b || a.length !== b.length) return null; let s = 0; for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]); return s / 2; };
const lookMix = (a, b, w = .5) => !a ? b : !b ? a : a.map((v, i) => (1 - w) * v + w * b[i]);
let persons = [], rawToPid = {}, nextPid = 1, stats = { detections: 0, raw: new Set(), persons: new Set() };
// Floor-level tracker: people are followed on the map, not by each camera's tracker numbers (those jump between people when paths
// cross or someone is hidden). Every round, merged sightings are given to map people by predicted position, with the camera track
// number and clothing colour as hints. A new person gets a number only after TRACK.confirm sightings; a hidden person coasts and can
// be re-found by clothes for REID_MS; two map people sitting on top of each other are folded into the older one.
// Tuned on B1-01 (4 cameras, 6 people; two recorded runs replayed and scored against truth): 19.7 -> 1.25 map ids per person.
const TRACK = { closeM: 1.0, embK: .1, mergeM: 1.2, keepM: 2.0, camErrM: .7, posK: .6, roughW: .25, roughNoSpawn: true, gateBase: 1.2, gatePerS: 1.2, gateMax: 3.5, keyBonus: .5, lookW: 3, confirm: 4, coastMs: 3000, tentMs: 1000, dupM: 1.5, dupMs: 500, bindMinSim: .5 }; /* bindMinSim: a camera's own track number stops counting when the clothes clearly differ: its tracker swaps numbers when people cross (B3-20: 7 -> 3 switches) */
let nextTid = 1;
function link(seen, now) {
  const on = $("relink").checked;
  if (!on) { for (const p of seen) { const keys = (p.keys ?? []).filter(k => k !== undefined); if (!keys.length || !p.floor) continue;
      const pid = keys.map(k => rawToPid[k]).find(x => x !== undefined) ?? nextPid++; keys.forEach(k => rawToPid[k] = pid); p.pid = pid; p.smooth = p.floor; }
    ghosts = []; return; }
  const obs = seen.filter(p => p.floor), pred = q => { const t = Math.min(now - q.seen, PREDICT_MS) / 1000; return [q.pos[0] + q.v[0] * t, q.pos[1] + q.v[1] * t]; };
  const cand = [];
  obs.forEach((p, i) => { const keys = (p.keys ?? []).filter(k => k !== undefined);
    persons.forEach((q, j) => { const dt = (now - q.seen) / 1000; if (dt <= 0) return;
      const d = dist(pred(q), p.floor), sim = lookSim(q.look, p.look), sameKey = keys.some(k => q.keys.has(k) && now - q.keys.get(k) < 2000);
      let cost;
      if (dt * 1000 > TRACK.coastMs) { // lost for a while: only clothes that match and a walkable distance bring them back
        if (q.pid === undefined || sim === null || sim < LOOK_SAME || d > Math.min(8, 1 + MAX_SPEED * dt)) return; cost = 1.2 + (1 - sim) * 4 + d / 8; }
      else { const gate = Math.min(TRACK.gateMax, TRACK.gateBase + TRACK.gatePerS * dt);
        if (d > gate * (sameKey ? 1.5 : 1)) return; if (sim !== null && sim < LOOK_DIFF && !sameKey) return;
        cost = d / gate - (sameKey ? TRACK.keyBonus : 0) + (sim === null ? 0 : (1 - sim) * TRACK.lookW) + (q.pid === undefined ? .3 : 0); }
      cand.push({ i, j, cost }); }); });
  const usedO = new Set(), usedP = new Set(), got = new Map();
  for (const c of cand.sort((a, b) => a.cost - b.cost)) { if (usedO.has(c.i) || usedP.has(c.j)) continue; usedO.add(c.i); usedP.add(c.j); got.set(c.i, persons[c.j]); }
  const update = (q, p) => { const dt = (now - q.seen) / 1000;
    if (dt > 0) { let vx = (p.floor[0] - q.pos[0]) / dt, vy = (p.floor[1] - q.pos[1]) / dt; const sp = Math.hypot(vx, vy); if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
      const k = dt > 1 ? 1 : .5; q.v = dt > 1 ? [0, 0] : [.5 * q.v[0] + .5 * vx, .5 * q.v[1] + .5 * vy]; q.pos = [(1 - k) * q.pos[0] + k * p.floor[0], (1 - k) * q.pos[1] + k * p.floor[1]]; }
    q.seen = now; q.hits++; q.counted = p.counted; (p.keys ?? []).forEach(k => k !== undefined && q.keys.set(k, now));
    if (p.look && p.clear) q.look = lookMix(q.look, p.look, q.look ? .15 : 1); };
  obs.forEach((p, i) => { const q = got.get(i); if (q) update(q, p); });
  obs.forEach((p, i) => { if (got.has(i)) return; // nobody fits: the same person seen a little off by another camera, or someone new
    const near = [...got.values()].find(q => q.pid !== undefined && dist(q.pos, p.floor) < TRACK.dupM);
    if (near) { got.set(i, near); p.dupOf = near; return; }
    const q = { tid: nextTid++, pid: undefined, pos: p.floor, v: [0, 0], seen: now, born: now, hits: 0, keys: new Map(), look: null, counted: p.counted }; update(q, p); persons.push(q); got.set(i, q); });
  for (const q of persons) if (q.pid === undefined && q.hits >= TRACK.confirm) q.pid = nextPid++;
  // two numbered people on the same spot for a while are one person (e.g. a camera's offset made a second one): keep the older number
  const live = persons.filter(q => q.pid !== undefined && q.seen === now);
  for (const a of live) for (const b of live) if (a.pid < b.pid && persons.includes(b)) {
    if (dist(a.pos, b.pos) < TRACK.dupM) { b.close ??= {}; b.close[a.pid] ??= now; if (now - b.close[a.pid] > TRACK.dupMs) { a.hits += b.hits; b.keys.forEach((t, k) => a.keys.set(k, t)); absorb(a.pid, b.pid); } }
    else if (b.close) delete b.close[a.pid]; }
  for (const q of persons) if (q.pid !== undefined) q.keys.forEach((t, k) => { if (now - t < 2000) rawToPid[k] = q.pid; });
  obs.forEach((p, i) => { const q = got.get(i); if (!q || !persons.includes(q)) { p.dup = true; return; } p.pid = q.pid; p.smooth = q.pos; p.dup = q.pid === undefined || !!p.dupOf; });
  // the map shows one dot per numbered person (the first sighting given to them), not one per camera
  const shown = new Set(); for (const p of obs) if (!p.dup) { if (shown.has(p.pid)) p.dup = true; else shown.add(p.pid); }
  persons = persons.filter(q => q.pid === undefined ? now - q.seen <= TRACK.tentMs : now - q.seen <= REID_MS);
  ghosts = persons.filter(q => q.pid !== undefined && q.seen !== now && now - q.seen <= TRACK.coastMs).map(q => { const t = Math.min(now - q.seen, PREDICT_MS) / 1000; return { pid: q.pid, counted: q.counted, pos: [q.pos[0] + q.v[0] * t, q.pos[1] + q.v[1] * t] }; });
}

// ---- Multi-camera floor tracker. Each map person is one track. Every round, each camera's sightings are assigned to the tracks on
// their own (optimal assignment), so two people standing close are kept apart by whichever camera sees them apart. A track remembers
// which camera-track number it holds in each view (ByteTrack keeps people well inside one view) and gets it again first; its position
// is the mean of its sightings from all cameras. Sightings nobody claims start a new track (one per spot, from all cameras together);
// it gets a map number after TRACK.confirm rounds. A lost track coasts, then can be re-found by clothing colour for REID_MS.
function assign(cost) { // Hungarian method on a rows x cols cost matrix (Infinity = not allowed); returns [row, col] pairs
  const n = cost.length, m = n ? cost[0].length : 0; if (!n || !m) return [];
  const N = Math.max(n, m), BIG = 1e6, a = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => i < n && j < m && isFinite(cost[i][j]) ? cost[i][j] : BIG));
  const u = new Array(N + 1).fill(0), v = new Array(N + 1).fill(0), p = new Array(N + 1).fill(0), way = new Array(N + 1).fill(0);
  for (let i = 1; i <= N; i++) { p[0] = i; let j0 = 0; const minv = new Array(N + 1).fill(Infinity), used = new Array(N + 1).fill(false);
    do { used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= N; j++) if (!used[j]) { const cur = a[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
      for (let j = 0; j <= N; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; j0 = j1; } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0); }
  const out = []; for (let j = 1; j <= N; j++) if (p[j] && p[j] - 1 < n && j - 1 < m && a[p[j] - 1][j - 1] < BIG) out.push([p[j] - 1, j - 1]); return out;
}
const camOfKey = k => String(k ?? "?").split(":")[0];
function trackRound(perCam, now) { // perCam: [[sightings of one camera]], each {floor, keys:[cam:id], look, clear, counted, zones, src, floors}
  const pred = q => { const t = Math.min(now - q.seen, PREDICT_MS) / 1000; return [q.pos[0] + q.v[0] * t, q.pos[1] + q.v[1] * t]; };
  const got = new Map(), free = []; // track -> its sightings this round
  for (const list of perCam) { const obs = list.filter(p => p.floor); if (!obs.length) continue;
    const cost = persons.map(q => { const dt = (now - q.seen) / 1000, P = pred(q);
      return obs.map(p => { const d = dist(P, p.floor), key = p.keys[0], sim = appSim(q, p), bound = key !== undefined && q.bind[camOfKey(key)] === key && !(sim !== null && sim < TRACK.bindMinSim);
        if (dt * 1000 > TRACK.coastMs) { // lost for a while: only matching clothes and a walkable distance bring them back
          if (q.pid === undefined || sim === null || sim < LOOK_SAME || d > Math.min(8, 1 + MAX_SPEED * dt)) return Infinity; return 1.5 + (1 - sim) * 4 + d / 8; }
        const gate = Math.min(TRACK.gateMax, TRACK.gateBase + TRACK.gatePerS * dt) + TRACK.camErrM;
        if (d > gate * (bound ? 1.5 : 1)) return Infinity; if (sim !== null && sim < LOOK_DIFF && !bound) return Infinity;
        return d / gate - (bound ? TRACK.keyBonus : 0) + (sim === null ? 0 : (1 - sim) * TRACK.lookW) + (q.pid === undefined ? .3 : 0); }); });
    const taken = new Set();
    for (const [j, i] of assign(cost)) { const q = persons[j]; taken.add(i); if (!got.has(q)) got.set(q, []); got.get(q).push(obs[i]); }
    obs.forEach((p, i) => { if (!taken.has(i)) free.push(p); }); }
  // unclaimed sightings: one new track per spot (different cameras within mergeM), unless a claimed track is right there
  const groups = [];
  for (const p of free) { const cam = p.src[0][0]; if ((p.rough || p.weakSeen) && TRACK.roughNoSpawn) continue;
    const near = [...got.keys()].find(q => dist(q.pos, p.floor) < TRACK.dupM); if (near) { got.get(near).push({ ...p, extra: true }); continue; }
    const g = groups.find(g => !g.cams.has(cam) && dist(mean(g.obs.map(o => o.floor)), p.floor) < TRACK.mergeM); if (g) { g.obs.push(p); g.cams.add(cam); } else groups.push({ obs: [p], cams: new Set([cam]) }); }
  for (const g of groups) { const q = { tid: nextTid++, pid: undefined, pos: mean(g.obs.map(o => o.floor)), v: [0, 0], seen: now, born: now, hits: 0, bind: {}, look: null }; persons.push(q); got.set(q, g.obs); }
  // update tracks from their sightings
  for (const [q, obs] of got) { const own = obs.filter(o => !o.extra), use = own.length ? own : obs, dt = (now - q.seen) / 1000;
    const wt = o => o.rough || o.weakSeen ? TRACK.roughW : 1, sw = use.reduce((t, o) => t + wt(o), 0), X = [use.reduce((t, o) => t + wt(o) * o.floor[0], 0) / sw, use.reduce((t, o) => t + wt(o) * o.floor[1], 0) / sw];
    if (dt > 0 && q.hits) { let vx = (X[0] - q.pos[0]) / dt, vy = (X[1] - q.pos[1]) / dt; const sp = Math.hypot(vx, vy); if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
      const k = dt > 1 ? 1 : TRACK.posK; q.v = dt > 1 ? [0, 0] : [.6 * q.v[0] + .4 * vx, .6 * q.v[1] + .4 * vy];
      q.pos = [(1 - k) * (q.pos[0] + q.v[0] * dt) + k * X[0], (1 - k) * (q.pos[1] + q.v[1] * dt) + k * X[1]]; }
    else q.pos = X;
    q.seen = now; q.hits++; q.obsNow = use; q.counted = obs.some(o => o.counted);
    for (const o of own) { const key = o.keys[0]; if (key === undefined) continue; const cam = camOfKey(key);
      for (const r of persons) if (r !== q && r.bind[cam] === key) delete r.bind[cam]; q.bind[cam] = key; }
    const clear = own.filter(o => o.clear && o.look); if (clear.length) q.look = lookMix(q.look, clear.reduce((acc, o, k) => lookMix(acc, o.look, 1 / (k + 1)), null), q.look ? .15 : 1);
    // appearance: the long-term look is learned only while nobody else is near (a crossing must not mix two people's looks);
    // the recent look is always kept, to check for swapped labels once people part
    const alone = !persons.some(r => r !== q && r.pid !== undefined && now - r.seen < 500 && dist(r.pos, q.pos) < TRACK.closeM);
    for (const o of own) if (o.emb && o.embOk) { if (alone || !q.emb) q.emb = embMix(q.emb, o.emb, q.emb ? TRACK.embK : 1); q.recent = embMix(q.recent, o.emb, q.recent ? .35 : 1); q.recentT = now; q.recentN = (q.recentN ?? 0) + 1; }
    for (let a = 0; a < own.length; a++) for (let b = a + 1; b < own.length; b++) (stats.gaps ??= []).push(dist(own[a].floor, own[b].floor)); }
  for (const q of persons) if (q.pid === undefined && q.hits >= TRACK.confirm) { const r = reviveFor(q, now); if (r) takeOver(q, r); else q.pid = nextPid++; }
  // two numbered tracks on one spot for a while, never seen by the same camera at once: one person (e.g. a camera's offset)
  const live = persons.filter(q => q.pid !== undefined && q.seen === now);
  for (const a of live) for (const b of live) if (a.pid < b.pid && persons.includes(a) && persons.includes(b)) {
    const ca = new Set(got.get(a).filter(o => !o.extra).map(o => o.src[0][0])), sameCam = got.get(b).some(o => !o.extra && ca.has(o.src[0][0]));
    if (dist(a.pos, b.pos) < TRACK.dupM && !sameCam) { b.close ??= {}; b.close[a.pid] ??= now;
      if (now - b.close[a.pid] > TRACK.dupMs) { for (const [cam, k] of Object.entries(b.bind)) a.bind[cam] ??= k; a.hits += b.hits; got.set(a, [...got.get(a), ...got.get(b)]); got.delete(b); absorb(a.pid, b.pid); } }
    else if (b.close) delete b.close[a.pid]; }
  persons = persons.filter(q => q.pid === undefined ? now - q.seen <= TRACK.tentMs : now - q.seen <= REID_MS);
  rawToPid = {}; for (const q of persons) if (q.pid !== undefined) for (const k of Object.values(q.bind)) rawToPid[k] = q.pid;
  ghosts = persons.filter(q => q.pid !== undefined && q.seen !== now && now - q.seen <= TRACK.coastMs).map(q => { const t = Math.min(now - q.seen, PREDICT_MS) / 1000; return { pid: q.pid, counted: q.counted, pos: [q.pos[0] + q.v[0] * t, q.pos[1] + q.v[1] * t] }; });
  // one entry per track for the page (map dot, numbers in the cameras, zones, the agreement figure)
  return [...got].filter(([q]) => persons.includes(q)).map(([q, obs]) => ({ pid: q.pid, floor: q.pos, smooth: q.pos, dup: q.pid === undefined, counted: q.counted,
    zones: [...new Set(obs.flatMap(o => o.zones))], src: obs.flatMap(o => o.src), keys: obs.flatMap(o => o.keys), floors: obs.flatMap(o => o.floors) }));
}

// A new track is about to get a number: is it someone lost earlier? Walking from one camera into another with no shared view
// between them, or coming out from behind something after more than TRACK.coastMs, starts a new track; the old number is kept
// when exactly one lost person looks clearly like them and could have walked there in the time.
const REVIVE = { gapM: 3.0, margin: .15, minS: .65, overlapMs: 1000, sureS: .85, sureM: 2 }; /* a clear look match may sit further off: feet cut at a frame edge put the floor point 2-4 m out (B2-11 33.9 s: look .92, 3.8 m) */ /* a person who walks into the next camera starts a new track while the old one still coasts on its last sighting: B3-17 cam1->cam2 overlapped 0.3 s, look .74, 2.3 m apart (a body cut at the frame edge puts the floor point off) */
function reviveFor(q, now) { if (globalThis.noRevive) return null;
  const cands = persons.filter(r => r !== q && r.pid !== undefined && r.seen < now && r.seen - q.born <= REVIVE.overlapMs && now - r.seen <= REID_MS)
    .map(r => ({ r, s: appSim(r, q), d: dist(r.pos, q.pos), dt: (now - r.seen) / 1000 }))
    .filter(c => c.s !== null && c.s >= REVIVE.minS && c.d <= REVIVE.gapM + MAX_SPEED * c.dt + (c.s >= REVIVE.sureS ? REVIVE.sureM : 0)).sort((a, b) => b.s - a.s);
  if (!cands.length || (cands[1] && cands[0].s - cands[1].s < REVIVE.margin)) return null;
  // the same lost person must not look as much like another new track that appeared at about the same time
  const rival = persons.some(o => o !== q && o.pid === undefined && o.hits >= 2 && o.born >= cands[0].r.seen && (appSim(cands[0].r, o) ?? 0) > cands[0].s - REVIVE.margin);
  return rival ? null : cands[0].r;
}
function takeOver(q, r) { q.pid = r.pid; for (const [cam, k] of Object.entries(r.bind)) if (!q.bind[cam]) q.bind[cam] = k;
  q.hits += r.hits; if (!q.emb) q.emb = r.emb; q.look = q.look ? lookMix(r.look, q.look, .5) : r.look; persons = persons.filter(x => x !== r); (stats.revived = (stats.revived ?? 0) + 1); }
function absorb(keep, gone) {
  for (const k in rawToPid) if (rawToPid[k] === gone) rawToPid[k] = keep;
  persons = persons.filter(x => x.pid !== gone);
  insideHits[keep] = (insideHits[keep] ?? 0) + (insideHits[gone] ?? 0); delete insideHits[gone];
  if (everCounted.delete(gone) || insideHits[keep] >= MIN_HITS) everCounted.add(keep);
  stats.persons.delete(gone); (stats.absorbed = (stats.absorbed ?? 0) + 1);
  if (trails[gone]) { trails[keep] = [...(trails[keep] ?? []), ...trails[gone]].slice(-3000); delete trails[gone]; }
}

// ---- Camera from fewer clues: a real camera above the floor described directly (where it stands, how high, which way it
// looks, how much it zooms). Most CCTV cameras are not tilted sideways ("level", 1 unknown fewer) and a typed mounting
// height removes another, so 3 corners (or 2 corners + an edge) can be enough. No straight-line start is needed: many
// starting guesses around the clicked points, each refined; the best wins. Map: x right, y down; floor z = 0, camera at z = -h.
function poseG(q, opt, u0, v0) {
  let i = 4; const [yaw, pitch, cx, cy] = q, h = opt.height ?? Math.exp(q[i++]), f = Math.exp(q[i++]), roll = opt.level ? 0 : q[i++];
  const fwd = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  let right = norm3(cross([0, 0, 1], fwd)), down = cross(fwd, right);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll), r0 = right; right = r0.map((v, k) => c * v + s * down[k]); down = down.map((v, k) => c * v - s * r0[k]); }
  const C = [cx, cy, -h], R = [...right, ...down, ...fwd], t = [0, 1, 2].map(r => -(R[r * 3] * C[0] + R[r * 3 + 1] * C[1] + R[r * 3 + 2] * C[2]));
  return { G: [f * R[0] + u0 * R[6], f * R[1] + u0 * R[7], f * t[0] + u0 * t[2], f * R[3] + v0 * R[6], f * R[4] + v0 * R[7], f * t[1] + v0 * t[2], R[6], R[7], t[2]], h, f, C, R, t };
}
const PRIOR_PX = 4;
const WARM_MAX_PX = 8;
function poseFit(P, Ls, W, Hh, pp = null, opt = { level: true, height: null }) {
  const [u0, v0] = pp ?? [W / 2, Hh / 2], mapPts = [...P.map(o => o.X), ...Ls.flatMap(o => [o.a, o.b])], m = mapPts.length ? mean(mapPts) : [0, 0];
  const people = opt.people ?? [], PH = 1.7, PW = .4; // person height (m) and how much one person counts vs a click
  const resid = q => { const { G, R, t, f, h } = poseG(q, opt, u0, v0), out = [];
    for (const o of P) { const d = G[6] * o.X[0] + G[7] * o.X[1] + G[8], wt = o.w ?? 1; if (d <= 1e-6) { out.push(1e4, 1e4); continue; } const p = proj(G, o.X);
      let ex = (p[0] - o.x[0]) * wt, ey = (p[1] - o.x[1]) * wt;
      if (opt.robust && o.robust) { const e = Math.hypot(ex, ey), c = opt.robust, k = e > 1e-9 ? Math.sqrt(2 * c * c * (Math.sqrt(1 + (e / c) ** 2) - 1)) / e : 1; ex *= k; ey *= k; } // pseudo-Huber: a wrong match cannot pull far
      out.push(ex, ey); }
    if (people.length) { const Gi = inv(G);
      for (const s of people) { const fl = proj(Gi, s.foot), X = [fl[0], fl[1], -PH], zc = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
        if (!(zc > 1e-6) || Math.sign(Gi[6] * s.foot[0] + Gi[7] * s.foot[1] + Gi[8]) !== Math.sign(Gi[6] * u0 + Gi[7] * (Hh * .9) + Gi[8])) { out.push(50 * PW); continue; }
        const yc = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1]; out.push((f * yc / zc + v0 - s.head[1]) * PW); } }
    for (const o of Ls) { const da = G[6] * o.a[0] + G[7] * o.a[1] + G[8], db = G[6] * o.b[0] + G[7] * o.b[1] + G[8];
      if (da <= 1e-6 && db <= 1e-6) { out.push(1e4); continue; }
      // a partly hidden edge can run behind the camera: use the part in front
      let a = o.a, b = o.b; if (da <= 1e-6 || db <= 1e-6) { const tt = (1e-3 - (da <= 1e-6 ? da : db)) / ((da <= 1e-6 ? db : da) - (da <= 1e-6 ? da : db)), s0 = da <= 1e-6 ? o.a : o.b, s1 = da <= 1e-6 ? o.b : o.a, cut = [s0[0] + tt * (s1[0] - s0[0]), s0[1] + tt * (s1[1] - s0[1])]; if (da <= 1e-6) a = cut; else b = cut; }
      out.push(lineDist(o.x, proj(G, a), proj(G, b)) * (o.w ?? 1)); }
    // weak prior "a usual CCTV camera" (focal ~0.9 x picture width, ~3 m up): only matters when the clicks say little or disagree,
    // so a few imprecise far-away corners cannot produce a 30 m high telephoto camera
    if (opt.prior !== false) { out.push(Math.log(f / (.9 * W)) * PRIOR_PX); if (!opt.height) out.push(Math.log(h / 3) * PRIOR_PX); }
    return out; };
  const lm = (q0, maxIt = 50) => { let q = [...q0], r = resid(q), cost = r.reduce((a, v) => a + v * v, 0), lambda = 1e-2;
    for (let it = 0; it < maxIt && lambda < 1e8; it++) {
      const J = q.map((v, k) => { const e = 1e-6 * (1 + Math.abs(v)), qq = [...q]; qq[k] += e; return resid(qq).map((x, i) => (x - r[i]) / e); });
      const n = q.length, A = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => J[i].reduce((a, x, t) => a + x * J[j][t], 0) * (i === j ? 1 + lambda : 1)), -J[i].reduce((a, x, t) => a + x * r[t], 0)]);
      for (let c = 0; c < n; c++) { let pv = c; for (let rr = c + 1; rr < n; rr++) if (Math.abs(A[rr][c]) > Math.abs(A[pv][c])) pv = rr; [A[c], A[pv]] = [A[pv], A[c]];
        for (let rr = 0; rr < n; rr++) if (rr !== c && A[c][c]) { const fc = A[rr][c] / A[c][c]; for (let k = c; k <= n; k++) A[rr][k] -= fc * A[c][k]; } }
      const trial = q.map((v, i) => v + (A[i][i] ? A[i][n] / A[i][i] : 0)), rt = resid(trial), ct = rt.reduce((a, v) => a + v * v, 0);
      if (isFinite(ct) && ct < cost) { const done = cost - ct < 1e-9 * (1 + cost); q = trial; r = rt; cost = ct; lambda = Math.max(1e-9, lambda / 3); if (done) break; } else lambda *= 4;
    }
    return { q, cost, n: r.length }; };
  let best = null;
  /* warm start: while corners or a Reference are being adjusted the camera barely moves, so the last answer is tried first and the
     144-start search (~0.5 s) runs only when that answer is clearly worse than before or not a good fit (B3-20 cam1: 562 ms per solve) */
  const nq = 4 + (opt.height ? 0 : 1) + 1 + (opt.level ? 0 : 1);
  if (opt.warm?.q?.length === nq) { const s = lm(opt.warm.q), rms = Math.sqrt(s.cost / Math.max(1, s.n)); if (rms <= WARM_MAX_PX && rms <= 1.25 * opt.warm.pxRms + .5) best = s; }
  const starts = [];
  if (!best) for (let yi = 0; yi < 8; yi++) for (const pitch of [.45, .8, 1.15]) for (const f of [.7 * W, 1.2 * W, 2 * W]) for (const h of opt.height ? [opt.height] : [2.5, 4]) {
    const yaw = yi * Math.PI / 4, d = h / Math.tan(pitch), q0 = [yaw, pitch, m[0] - d * Math.cos(yaw), m[1] - d * Math.sin(yaw)];
    if (!opt.height) q0.push(Math.log(h)); q0.push(Math.log(f)); if (!opt.level) q0.push(0);
    starts.push(lm(q0, 6)); }
  /* every start gets 6 steps, only the 8 most promising are finished (the same answer as finishing all 144, at about a fifth of the time) */
  if (!best) for (const s of starts.sort((a, b) => a.cost - b.cost).slice(0, 8)) { const t = lm(s.q); if (!best || t.cost < best.cost) best = t; }
  if (!best) return null;
  const { G, h, f, C, R, t } = poseG(best.q, opt, u0, v0); if (!(f > .2 * W && f < 8 * W) || !(h > .3 && h < 30)) return null;
  const Hq = inv(G); return { H: Hq.map(v => v / Hq[8]), f, height: h, pos: [C[0], C[1]], pxRms: Math.sqrt(best.cost / Math.max(1, best.n)), q: best.q, cam: { R, t, f, u0, v0 } };
}
// picture -> floor spot under a point at height z above the floor (e.g. a head at 1.7 m), for a fitted real camera
function headToFloor(cam, z) {
  const { R, t, f, u0, v0 } = cam, Z = -z; // the floor is z = 0 and up is -z (camera at z = -height)
  const Gz = [f * R[0] + u0 * R[6], f * R[1] + u0 * R[7], f * (R[2] * Z + t[0]) + u0 * (R[8] * Z + t[2]),
              f * R[3] + v0 * R[6], f * R[4] + v0 * R[7], f * (R[5] * Z + t[1]) + v0 * (R[8] * Z + t[2]), R[6], R[7], R[8] * Z + t[2]];
  const H = inv(Gz); return H.map(v => v / H[8]);
}
