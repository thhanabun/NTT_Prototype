"""cross-camera consistency of a calibration: foot points of YOLO detections of cam A vs cam B at the same time, compared with a time-shifted baseline"""
import sys, itertools
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import *
def feet(ds, c):
    ci = cam_info(ds, c); d = json.loads((SCAN / (ci["video"].stem + ".json")).read_text()); out = {}
    for k, bs in d.items():
        p = [((b[0] + b[2]) / 2, b[3]) for b in bs if b[3] - b[1] > 25 and 2 < b[3] < 286]
        out[int(k)] = apply_H(ci["H"], p) * ci["unit_m"] if p else np.zeros((0, 2))
    return out
def check(ds, cams, shift=300):
    F = {c: feet(ds, c) for c in cams}; res = {}
    for a, b in itertools.combinations(cams, 2):
        same, base = [], []
        ks = sorted(set(F[a]) & set(F[b]))
        for k in ks:
            A, B = F[a][k], F[b][k]
            if len(A) and len(B):
                D = np.linalg.norm(A[:, None] - B[None], axis=2); same += list(D.min(1))
                k2 = ks[(ks.index(k) + shift // 15) % len(ks)]; B2 = F[b][k2]
                if len(B2): base += list(np.linalg.norm(A[:, None] - B2[None], axis=2).min(1))
        res[(a, b)] = (round(float(np.median(same)), 2) if same else None, round(float(np.median(base)), 2) if base else None, round(float(np.mean(np.array(same) < 0.6)), 2) if same else None, round(float(np.mean(np.array(base) < 0.6)), 2) if base else None)
    return res
if __name__ == "__main__":
    ds = sys.argv[1]; cams = [int(x) for x in sys.argv[2].split(",")]
    for k, v in check(ds, cams).items(): print(ds, k, "median min-dist same-time / shifted:", v[0], v[1], " frac<0.6m same / shifted:", v[2], v[3])
