"""Scoring only: page's camera fits (read from page) vs truth homographies. usage: align_score.py <scenario> <fits.json>
Joint similarity (scale+rot+trans, no reflection check) page-map->truth floor, then per-camera median/p90 error and pairwise agreement."""
import json, sys, numpy as np
def apply(H, pts):
    H = np.array(H, float).reshape(3, 3); p = np.c_[pts, np.ones(len(pts))] @ H.T; return p[:, :2] / p[:, 2:3]
def umeyama(a, b):
    ma, mb = a.mean(0), b.mean(0); A, B = a - ma, b - mb; U, S, Vt = np.linalg.svd(B.T @ A / len(a))
    d = np.sign(np.linalg.det(U @ Vt)); D = np.diag([1, d]); R = U @ D @ Vt; s = (S * np.diag(D)).sum() / (A ** 2).sum() * len(a); t = mb - s * R @ ma; return s, R, t, d
MAX_D = 20.0  # metres: grid points farther than this from the camera's nearest floor (or past the horizon) are left out:
# a deep outdoor view (campus cam1) reaches 40+ m at row 0.45, far outside any store map, and one such point's error swamped the score
def grid_pts(c):
    w, h = c["size"]; g = np.array([[x, y] for x in np.linspace(.2 * w, .8 * w, 7) for y in np.linspace(.45 * h, .95 * h, 7)])
    H = np.array(c["H_img_to_floor_m"], float).reshape(3, 3); z = (np.c_[g, np.ones(len(g))] @ H.T)[:, 2]; z0 = (H @ [w / 2, h, 1])[2]
    near = apply(H, [[w / 2, h]])[0]; d = np.linalg.norm(apply(H, g) - near, axis=1); keep = (np.sign(z) == np.sign(z0)) & (d <= MAX_D)
    return g[keep] if keep.sum() >= 10 else g[np.argsort(np.where(np.sign(z) == np.sign(z0), d, 9e9))[:10]]
def main(sc, fits_path):
    t = json.load(open(f"videos/{sc}/truth.json")); fits = json.load(open(fits_path))["fits"]
    grid = lambda w, h: np.array([[x, y] for x in np.linspace(.2 * w, .8 * w, 7) for y in np.linspace(.45 * h, .95 * h, 7)])
    P, T, idx = [], [], []
    for i, (c, f) in enumerate(zip(t["cameras"], fits)):
        if not f.get("H"): continue
        g = grid_pts(c); P.append(apply(f["H"], g)); T.append(apply(c["H_img_to_floor_m"], g)); idx += [i] * len(g)
    P, T, idx = np.vstack(P), np.vstack(T), np.array(idx); out = {"unit_m": t.get("floor_unit_m")}
    best = None
    for flip in (1, -1):  # allow mirrored page frame (map y axis points the other way)
        Pm = P * [1, flip]; s, R, tt, d = umeyama(Pm, T); res = np.linalg.norm(s * Pm @ R.T + tt - T, axis=1)
        if best is None or np.median(res) < np.median(best[0]): best = (res, flip, s)
    res, flip, s = best
    u = float(t.get("floor_unit_m") or 1)
    out.update(flip=flip, scale=float(s), per_cam={int(i): {"median_m": float(np.median(res[idx == i]) ), "p90_m": float(np.percentile(res[idx == i], 90))} for i in set(idx)})
    out["overall_median"] = float(np.median(res)); out["pass_align_0.30"] = bool(np.median(res) <= 0.30)
    print(json.dumps(out, indent=1)); return out
if __name__ == "__main__": main(*sys.argv[1:3])

def per_cam_shape(sc, fits_path):
    """each camera alone: best similarity (mirror allowed) page->truth; shows how good its own floor is."""
    t = json.load(open(f"videos/{sc}/truth.json")); fits = json.load(open(fits_path))["fits"]; r = {}
    for i, (c, f) in enumerate(zip(t["cameras"], fits)):
        if not f.get("H"): r[i] = None; continue
        g = grid_pts(c)
        P, T = apply(f["H"], g), apply(c["H_img_to_floor_m"], g); best = 9e9
        for fl in (1, -1):
            s, R, tt, d = umeyama(P * [1, fl], T); e = np.median(np.linalg.norm(s * (P * [1, fl]) @ R.T + tt - T, axis=1)); best = min(best, e)
        r[i] = round(float(best), 3)
    return r
