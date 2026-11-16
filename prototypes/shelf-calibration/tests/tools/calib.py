"""Floor calibration + ground truth loaders for the EPFL CVLab / WILDTRACK datasets (research use, (c) CVLab EPFL).
All H returned map SOURCE-VIDEO pixels -> floor coordinates in the dataset's own unit; `unit_m` converts the unit to metres."""
import re, json, zipfile
from pathlib import Path
import numpy as np, cv2
DL = Path(__file__).resolve().parent.parent / "downloads"
EP = DL / "epfl"

def read_homographies(txt):
    """image->ground homographies of every 'Camera N' block in an EPFL calibration-*.txt"""
    t = open(txt).read(); out = {}
    for m in re.finditer(r"# Camera (\d)\s*#+\s*(?:#\s*Camera \d\s*#+\s*)?# Ground plane homography\s*([-\d.eE+\s]+?)#", t, re.S):
        v = [float(x) for x in m.group(2).split()]
        if len(v) == 9: out[int(m.group(1))] = np.array(v).reshape(3, 3)
    return out

def tsai_params(xml):
    t = open(xml).read(); g = lambda k: float(re.search(k + r'="([^"]+)"', t).group(1))
    return {k: g(k) for k in ["ncx", "nfx", "dx", "dy", "dpx", "dpy", "focal", "kappa1", "cx", "cy", "sx", "tx", "ty", "tz", "rx", "ry", "rz"]}

def tsai_project(p, W):
    """world (N,3) -> distorted pixel (N,2) following Tsai's model"""
    cx_, sx_, cy_, sy_, cz_, sz_ = np.cos(p["rx"]), np.sin(p["rx"]), np.cos(p["ry"]), np.sin(p["ry"]), np.cos(p["rz"]), np.sin(p["rz"])
    R = np.array([[cy_ * cz_, sx_ * sy_ * cz_ - cx_ * sz_, cx_ * sy_ * cz_ + sx_ * sz_],
                  [cy_ * sz_, sx_ * sy_ * sz_ + cx_ * cz_, cx_ * sy_ * sz_ - sx_ * cz_],
                  [-sy_, sx_ * cy_, cx_ * cy_]])
    Pc = W @ R.T + np.array([p["tx"], p["ty"], p["tz"]])
    xu, yu = p["focal"] * Pc[:, 0] / Pc[:, 2], p["focal"] * Pc[:, 1] / Pc[:, 2]
    ru = np.hypot(xu, yu); rd = ru.copy()
    for _ in range(30): rd = ru / (1 + p["kappa1"] * rd ** 2)  # solve rd(1+k rd^2)=ru
    s = np.where(ru > 0, rd / np.maximum(ru, 1e-12), 1)
    return np.c_[xu * s * p["sx"] / p["dpx"] + p["cx"], yu * s / p["dpy"] + p["cy"]], Pc[:, 2]

def tsai_ground_H(xml, area, step, size=(720, 576)):
    """homography pixel->world(X,Y) at Z=0 fitted on a dense grid of ground points that fall inside the picture"""
    p = tsai_params(xml); x0, y0, x1, y1 = area
    gx, gy = np.meshgrid(np.arange(x0, x1, step), np.arange(y0, y1, step)); W = np.c_[gx.ravel(), gy.ravel(), np.zeros(gx.size)]
    px, z = tsai_project(p, W); ok = (z > 0) & (px[:, 0] >= 0) & (px[:, 0] < size[0]) & (px[:, 1] >= 0) & (px[:, 1] < size[1])
    H, _ = cv2.findHomography(px[ok].astype(np.float32), W[ok, :2].astype(np.float32), 0)
    return H, int(ok.sum())

def grid_pos(pos, gw, gh, ox, oy, tw, th):
    return (pos % gw + .5) * tw / gw + ox, (pos // gw + .5) * th / gh + oy

def read_gt(path, ox, oy, tw, th):
    """EPFL gt_*.txt -> {frame: {person_idx: (x, y) in top-view units}}"""
    lines = [l.split() for l in open(path).read().splitlines() if l.strip()]
    n, npe, gw, gh, step, f0, f1 = map(int, lines[1]); gt = {}
    for k, row in enumerate(lines[2:2 + n]):

        d = {}
        for i, v in enumerate(map(int, row)):
            if v >= 0: d[i] = grid_pos(v, gw, gh, ox, oy, tw, th)
        if d: gt[k] = d
    return gt, step

def apply_H(H, pts):
    return cv2.perspectiveTransform(np.float32(pts).reshape(-1, 1, 2), np.asarray(H, np.float64)).reshape(-1, 2)

# ---------------------------------------------------------------- dataset registry
AREAS = {"campus": (-40, -40, 40, 40, 0.1), "terrace": (-3000, -4000, 9000, 13000, 25)}
LICENCE_EPFL = "CVLab-EPFL research use only (c) CVLab EPFL; https://www.epfl.ch/labs/cvlab/data-pom-index-php"
_cache = {}

def cam_info(ds, c):
    """-> dict(video=Path, H=3x3 pixel->floor(unit), unit_m=float, size=(w,h), fps)"""
    k = (ds, c)
    if k in _cache: return _cache[k]
    if ds in ("lab4p", "lab6p"):
        tag = ds[3:]; H = read_homographies(EP / f"calibration-{tag}.txt")[c]; v = EP / f"{tag}-c{c}.avi"; u = 0.03
    elif ds == "passageway":
        H = read_homographies(EP / "calibration-passageway.txt")[c]; v = EP / f"passageway1-c{c}.avi"; u = 0.05
    elif ds in ("campus4", "campus7"):
        H = read_homographies(EP / "calibration-campus.txt")[c]; v = EP / f"{ds}-c{c}.avi"; u = 0.018
    elif ds in ("terrace1", "terrace2"):
        H = read_homographies(EP / "calibration-terrace.txt")[c]; v = EP / f"{ds}-c{c}.avi"; u = 0.018232   # 0.0086 x 2.12: people (1.7 m) came out 0.8 m tall in the page fit
    elif ds == "match5":
        H, u = basketball_H(c); v = EP / f"match5-c{c}.avi"
        _cache[k] = dict(video=v, H=H, unit_m=u, size=(360, 288), fps=25.0); return _cache[k]
    else: raise KeyError(ds)
    _cache[k] = dict(video=v, H=np.asarray(H, float), unit_m=u, size=(360, 288), fps=25.0)
    return _cache[k]

GT_SPEC = {"lab6p": ("gt_lab_6p.txt", 0, 0, 358, 360),
           "passageway": ("gt_passageway1.txt", 0, 38.48, 155, 381)}


def basketball_cams():
    t = open(EP / "calibration-basketball.txt").read(); out = []
    for blk in re.split(r"camera \d\s*\n", t)[1:]:
        nums = lambda s_: [float(x) for x in s_.split()]
        K = np.array(nums(re.search(r"internal parameters:?\s*([-\d.eE\s]+?)radial", blk, re.S).group(1))).reshape(3, 3)
        d = nums(re.search(r"radial distortion coefficients:\s*([-\d.eE ]+)", blk).group(1))
        P = np.array(nums(re.search(r"\[R -R\*T\]\s*([-\d.eE\s]+)", blk).group(1))[:12]).reshape(3, 4)
        out.append((K, d, P))
    return out

_bb = {}
def basketball_H(c):
    """pixel(360x288 avi) -> floor(calibration units) at Z=0; unit_m from camera height ~2 m (EPFL page: cameras ~2 m above ground) - ESTIMATE"""
    cams = basketball_cams()
    if "u" not in _bb:
        hs = [-(P[:, :3].T @ P[:, 3])[2] for _, _, P in cams]; _bb["u"] = 2.0 / float(np.mean(hs)); _bb["hs"] = hs
    K, d, P = cams[c]; R, t = P[:, :3], P[:, 3]
    gx, gy = np.meshgrid(np.arange(-3, 3, 0.01), np.arange(-3, 3, 0.01)); W = np.c_[gx.ravel(), gy.ravel(), np.zeros(gx.size)]
    px, _ = cv2.projectPoints(W, cv2.Rodrigues(R)[0], t, K, np.array([d[0], d[1], 0, 0, 0], float)); px = px.reshape(-1, 2) * 0.5   # to 360x288
    cam = W @ R.T + t; ok = (cam[:, 2] > 0) & (px[:, 0] >= 0) & (px[:, 0] < 360) & (px[:, 1] >= 0) & (px[:, 1] < 288)
    H, _ = cv2.findHomography(px[ok].astype(np.float32), W[ok, :2].astype(np.float32), 0)
    return H, _bb["u"]
