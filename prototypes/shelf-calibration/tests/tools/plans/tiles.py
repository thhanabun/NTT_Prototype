"""Detect the paving/tile joint lattice of a camera in floor coordinates (rectify the median background, find 2 line families)."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from calib import *

def background(video, n=25, step=None):
    cap = cv2.VideoCapture(str(video)); tot = int(cap.get(7)); fr = []
    for i in np.linspace(0, max(0, min(tot, 1700) - 1), n).astype(int):
        cap.set(1, int(i)); ok, f = cap.read()
        if ok: fr.append(f)
    return np.median(np.array(fr), 0).astype(np.uint8)

def lattice(img, H, unit_m, y_min, res_m=0.015, x_pad=0):
    """img BGR (source px), H px->floor(native), returns dict(period_m=(a,b), normals, phases, raster info)"""
    h, w = img.shape[:2]; s = res_m / unit_m                          # native units per raster px
    poly = apply_H(H, [[x_pad, y_min], [w - x_pad, y_min], [w - x_pad, h - 1], [x_pad, h - 1]]); lo, hi = poly.min(0), poly.max(0)
    W, Hh = int((hi[0] - lo[0]) / s), int((hi[1] - lo[1]) / s)
    if W * Hh > 4e6 or W < 20: return None
    M = np.linalg.inv(H) @ np.array([[s, 0, lo[0]], [0, s, lo[1]], [0, 0, 1.0]])
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    warp = cv2.warpPerspective(g, M, (W, Hh), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=-1)
    valid = (cv2.warpPerspective(np.ones_like(g), M, (W, Hh), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP) > 0)
    # only trust rows of the picture nearer than y_min
    d = np.clip(cv2.GaussianBlur(warp, (0, 0), 6) - cv2.GaussianBlur(warp, (0, 0), 1.2), 0, None) * valid
    d = cv2.erode(valid.astype(np.uint8), np.ones((9, 9), np.uint8)) * d
    best = None; ys, xs = np.nonzero(d > 0); cx, cy = xs.mean(), ys.mean()
    res = []
    for th in np.arange(0, 180, 1.0):
        t = np.radians(th); nx, ny = np.cos(t), np.sin(t)                    # normal of the line family
        yy, xx = np.nonzero(d > 0); proj = ((xx - cx) * nx + (yy - cy) * ny)
        prof, edges = np.histogram(proj, bins=np.arange(proj.min(), proj.max() + 2), weights=d[yy, xx]); cnt, _ = np.histogram(proj, bins=edges)
        prof = prof / np.maximum(cnt, 1); prof = prof - cv2.GaussianBlur(prof.astype(np.float32).reshape(-1, 1), (0, 0), 25).ravel()
        res.append((float(np.var(prof)), th, prof, edges[0]))
    res.sort(key=lambda r: -r[0]); t1 = res[0][1]
    # second family ~ orthogonal (+-15 deg)
    c2 = [r for r in res if abs(((r[1] - t1 + 90) % 180) - 90 - 90 + 90) < 0 or 75 <= ((r[1] - t1) % 180) <= 105]
    r2 = max(c2, key=lambda r: r[0]); out = []
    for var, th, prof, e0 in (res[0], r2):
        f = np.abs(np.fft.rfft(prof * np.hanning(len(prof)), n=8 * len(prof))); fr = np.fft.rfftfreq(8 * len(prof))
        ok = (fr > 1 / (4.0 / res_m)) & (fr < 1 / (0.15 / res_m)); k = np.argmax(np.where(ok, f, 0)); per = 1 / fr[k]
        # phase: maximise comb sum
        offs = np.arange(0, per, 0.5); sc = [np.sum(prof[(np.arange(o, len(prof), per)).astype(int)]) for o in offs]; ph = offs[int(np.argmax(sc))]
        out.append({"theta": th, "period_m": per * res_m, "phase_px": ph + e0, "strength": var})
    return {"fams": out, "c": (cx, cy), "lo": lo.tolist(), "s": s, "unit_m": unit_m}

def joint_points(L, box_native, margin=0):
    """all lattice intersections (floor native units) inside box_native=(x0,y0,x1,y1)"""
    pts = []; s, lo = L["s"], np.array(L["lo"]); cx, cy = L["c"]
    f1, f2 = L["fams"]; n1 = np.array([np.cos(np.radians(f1["theta"])), np.sin(np.radians(f1["theta"]))]); n2 = np.array([np.cos(np.radians(f2["theta"])), np.sin(np.radians(f2["theta"]))])
    p1, p2 = f1["period_m"] / L["unit_m"] / s, f2["period_m"] / L["unit_m"] / s                       # in raster px
    A = np.array([n1, n2]); Ainv = np.linalg.inv(A)
    for i in range(-80, 80):
        for j in range(-80, 80):
            t = np.array([f1["phase_px"] + i * p1, f2["phase_px"] + j * p2]); r = Ainv @ t + np.array([cx, cy]); p = lo + r * s
            if box_native[0] <= p[0] <= box_native[2] and box_native[1] <= p[1] <= box_native[3]: pts.append((i, j, p))
    return pts
