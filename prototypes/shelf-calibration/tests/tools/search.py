"""search crops of two/three cameras of one dataset window so that the floor overlap is full / none / partial and >=2 people stay visible"""
import sys, itertools, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import *

def prep(ds, cams, f0, f1, cell_m=0.2):
    cs = [cam_info(ds, c) for c in cams]; unit = cs[0]["unit_m"]; cell = cell_m / unit
    fp = np.vstack([foot_points(ds, c, f0, f1) for c in cams]); lo, hi = np.percentile(fp, 5, 0), np.percentile(fp, 95, 0); span = hi - lo; lo, hi = lo - 0.3 * span - 10 * cell, hi + 0.3 * span + 10 * cell; cell = max(cell, float(np.max(hi - lo)) / 500)
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0], cell), np.arange(lo[1], hi[1], cell)); G = np.c_[gx.ravel(), gy.ravel()]
    ij = np.floor((fp - lo) / cell).astype(int); occ = np.zeros(gx.shape, np.uint8)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < gx.shape[1]) & (ij[:, 1] >= 0) & (ij[:, 1] < gx.shape[0]); occ[ij[ok, 1], ij[ok, 0]] = 1
    return G, cv2.dilate(occ, np.ones((5, 5), np.uint8)).ravel() > 0

def vis(ci, crop, G, occ):
    Hi = np.linalg.inv(ci["H"]); h = Hi @ np.c_[G, np.ones(len(G))].T; w = h[2]; px = (h[:2] / np.where(w == 0, 1e-9, w)).T
    x0, y0, x1, y1 = crop; cen = apply_H(ci["H"], [[(x0 + x1) / 2, (y0 + y1) / 2 + (y1 - y0) / 4]])[0]; s = np.sign((Hi @ [cen[0], cen[1], 1])[2])
    return (np.sign(w) == s) & (px[:, 0] >= x0) & (px[:, 0] < x1) & (px[:, 1] >= y0) & (px[:, 1] < y1) & occ

def cands(minw=160, minh=130, W=360, H=288, st=40):
    return [[x0, y0, x1, y1] for x0 in range(0, W - minw + 1, st) for x1 in range(x0 + minw, W + 1, st)
            for y0 in range(0, H - minh + 1, st) for y1 in range(y0 + minh, H + 1, st)]

def frac2(cnt, f0, f1, need=2):
    fr = [f for f in cnt if f0 <= f < f1]; return float(np.mean([cnt[f] >= need for f in fr])) if fr else 0

def search(ds, cams, start_s, dur_s, target, minfrac=0.6, need=2, minw=130, minh=110, top=3):
    """target: 'full' | 'none' | 'partial'; for 3+ cams every pair must satisfy it (partial: 0.15..0.7 and no pair none)"""
    f0 = int(start_s * 25); f1 = f0 + int(dur_s * 25); G, occ = prep(ds, cams, f0, f1); cs = [cam_info(ds, c) for c in cams]; per = []
    for c, ci in zip(cams, cs):
        cl = []
        for cr in cands(minw, minh):
            cnt = counts(ds, c, cr); f = frac2(cnt, f0, f1, need)
            if f >= minfrac:
                v = vis(ci, cr, G, occ)
                if v.sum() > 20: cl.append((cr, v, f, (cr[2] - cr[0]) * (cr[3] - cr[1])))
        per.append(cl); 
    res = []
    for combo in itertools.product(*[sorted(p, key=lambda t: -t[3])[:25] for p in per]):
        M = overlap_matrix([t[1] for t in combo]); off = [M[i, j] for i in range(len(M)) for j in range(i + 1, len(M))]
        if target == "full": sc = min(off)
        elif target == "none": sc = -max(off)
        else: sc = -abs(np.mean(off) - 0.4) - (1 if min(off) < 0.1 or max(off) > 0.7 else 0)
        res.append((sc + 1e-8 * sum(t[3] for t in combo), [t[0] for t in combo], np.round(off, 2).tolist(), [round(t[2], 2) for t in combo]))
    res.sort(key=lambda r: -r[0]); return res[:top]

if __name__ == "__main__":
    ds, cams, start, dur, target = sys.argv[1], [int(x) for x in sys.argv[2].split(",")], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
    for r in search(ds, cams, start, dur, target): print(r)
