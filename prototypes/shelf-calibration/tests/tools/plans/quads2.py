"""persistent Harris corners over ~24 frames -> floor coords -> lattice cells (quads of real tile joints)"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1])); sys.path.insert(0, str(Path(__file__).parent))
from calib import *
from build_wt import wt_H, WT
def frames_epfl(video, n=24):
    cap = cv2.VideoCapture(str(video)); out = []
    for i in np.linspace(0, 1600, n).astype(int):
        cap.set(1, int(i)); ok, f = cap.read()
        if ok: out.append(f)
    return out
def frames_wt(c, n=40):
    return [cv2.resize(cv2.imread(str(WT / "Image_subsets" / f"C{c}" / f"{k*5:08d}.png")), None, fx=.5, fy=.5, interpolation=cv2.INTER_AREA) for k in range(0, n)]
def persistent_corners(frames, y_min, quality=0.02, block=5, minfrac=0.4, maxc=300):
    pts = []
    for f in frames:
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY); h, w = g.shape; m = np.zeros_like(g); m[y_min:h - 3, 4:w - 4] = 255
        c = cv2.goodFeaturesToTrack(cv2.GaussianBlur(g, (0, 0), 1.0), maxc, quality, 4, mask=m, blockSize=block, useHarrisDetector=True, k=0.04)
        pts.append(np.zeros((0, 2)) if c is None else c.reshape(-1, 2))
    allp = np.vstack(pts); keep = []; r = 2.5
    from scipy.spatial import cKDTree
    t = [cKDTree(p) if len(p) else None for p in pts]; used = np.zeros(len(allp), bool)
    for i, p in enumerate(allp):
        if used[i]: continue
        cnt = sum(1 for tt in t if tt is not None and tt.query_ball_point(p, r)); 
        if cnt >= minfrac * len(frames):
            sel = [j for j in cKDTree(allp).query_ball_point(p, r)]; used[sel] = True; keep.append(allp[sel].mean(0))
    return np.array(keep)
def lattice_quads(c_px, H, unit_m, size_tol, mind, maxd):
    if len(c_px) < 6: return {"n": len(c_px), "basis": None, "quads": [], "quad_px": []}
    P = apply_H(H, c_px) * unit_m; n = len(P)
    if n < 6: return {"n": n, "basis": None, "quads": [], "quad_px": []}
    D = P[None] - P[:, None]; dist = np.linalg.norm(D, axis=2); dv = D[(dist > mind) & (dist < maxd)]
    dv = np.where(((dv[:, 0] < 0) | ((dv[:, 0] == 0) & (dv[:, 1] < 0)))[:, None], -dv, dv)
    step = max(0.03, mind / 4); bins = np.round(dv / step).astype(int); u, cnt = np.unique(bins, axis=0, return_counts=True); order = np.argsort(-cnt); a = b = None
    for k in order[:80]:
        v = u[k] * step
        if a is None: a = v; continue
        if abs(a[0] * v[1] - a[1] * v[0]) / (np.linalg.norm(a) * np.linalg.norm(v)) > 0.6: b = v; break
    if b is None: return {"n": n, "basis": None, "quads": [], "quad_px": []}
    def find(p, t):
        d = np.linalg.norm(P - (p + t), axis=1); j = int(np.argmin(d)); return j if d[j] < size_tol else None
    q = []
    for i in range(n):
        j1, j2, j3 = find(P[i], a), find(P[i], b), find(P[i], a + b)
        if None not in (j1, j2, j3): q.append([i, j1, j3, j2])
    return {"n": n, "basis": [a.tolist(), b.tolist()], "quads": [[P[k].tolist() for k in qq] for qq in q], "quad_px": [[c_px[k].tolist() for k in qq] for qq in q]}
if __name__ == "__main__":
    OUT = {}
    jobs = [(f"{ds}:{c}", frames_epfl(cam_info(ds, c)["video"]), cam_info(ds, c)["H"], cam_info(ds, c)["unit_m"], 130, dict(size_tol=0.06 if ds.startswith("lab") else 0.08, mind=0.2, maxd=1.5 if ds.startswith("lab") else 3.0))
            for ds, cams in (("terrace1", range(4)), ("campus4", range(3)), ("passageway", range(4))) for c in cams]
    jobs += [(f"wt:{c}", frames_wt(c), wt_H(c) @ np.diag([2.0, 2.0, 1.0]), 1.0, 220, dict(size_tol=0.12, mind=0.4, maxd=6.0)) for c in range(1, 8)]
    for key, fr, H, u, ymin, kw in jobs:
        pc = persistent_corners(fr, ymin); r = lattice_quads(pc, H, u, **kw); r["px"] = pc.tolist(); OUT[key] = r
        print(key, len(pc), None if r["basis"] is None else np.round(r["basis"], 2).tolist(), len(r["quads"]), flush=True)
    json.dump(OUT, open("tools/plans/quads2_all.json", "w"))
