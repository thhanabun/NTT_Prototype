"""tile-joint quads: Harris corners of the median background floor -> floor coords -> lattice basis from difference vectors -> complete cells"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
from tiles import background
from calib import *
def quads(img, H, unit_m, y_min, size_tol=0.07, maxd=3.0, mind=0.25, roi=None):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); h, w = g.shape
    m = np.zeros_like(g); m[y_min:h - 2, 3:w - 3] = 255
    if roi is not None: m = cv2.bitwise_and(m, roi)
    c = cv2.goodFeaturesToTrack(cv2.GaussianBlur(g, (0, 0), 1.0), 400, 0.03, 5, mask=m, blockSize=5, useHarrisDetector=True, k=0.04)
    if c is None: return None
    c = cv2.cornerSubPix(g, c.astype(np.float32), (4, 4), (-1, -1), (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01)).reshape(-1, 2)
    P = apply_H(H, c) * unit_m; n = len(P); D = P[None] - P[:, None]; dist = np.linalg.norm(D, axis=2)
    sel = (dist > mind) & (dist < maxd); dv = D[sel]
    # histogram of difference vectors (5 cm bins), fold sign
    dv = np.where((dv[:, 0] < 0) | ((dv[:, 0] == 0) & (dv[:, 1] < 0)))[0] if False else np.where(((dv[:, 0] < 0) | ((dv[:, 0] == 0) & (dv[:, 1] < 0)))[:, None], -dv, dv)
    bins = np.round(dv / 0.06).astype(int); u, cnt = np.unique(bins, axis=0, return_counts=True); order = np.argsort(-cnt)
    a = None; b = None
    for k in order[:60]:
        v = u[k] * 0.06
        if a is None: a = v; continue
        cr = abs(a[0] * v[1] - a[1] * v[0]) / (np.linalg.norm(a) * np.linalg.norm(v))
        if cr > 0.6: b = v; break
    if b is None: return {"basis": None, "n": n, "pts": P.tolist(), "px": c.tolist()}
    def find(p, t):
        d = np.linalg.norm(P - (p + t), axis=1); j = int(np.argmin(d)); return j if d[j] < size_tol else None
    out = []
    for i in range(n):
        j1, j2, j3 = find(P[i], a), find(P[i], b), find(P[i], a + b)
        if None not in (j1, j2, j3): out.append([i, j1, j3, j2])
    return {"basis": [a.tolist(), b.tolist()], "n": n, "quads": [[P[k].tolist() for k in q] for q in out], "quad_px": [[c[k].tolist() for k in q] for q in out], "pts": P.tolist(), "px": c.tolist()}
if __name__ == "__main__":
    for ds, ymin in (("terrace1", 150), ("campus4", 150)):
        for cc in range(3):
            ci = cam_info(ds, cc); bg = cv2.imread(f"tools/scratch/bg_{ds}_{cc}.png"); r = quads(bg, ci["H"], ci["unit_m"], ymin)
            print(ds, cc, r["n"], "basis", None if r["basis"] is None else np.round(r["basis"], 2).tolist(), "quads", len(r.get("quads", [])))
