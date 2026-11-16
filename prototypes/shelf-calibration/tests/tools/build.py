"""Build one scenario: crops/resizes source videos into tests/videos/<id>/cam<N>.webm and writes truth.json.
spec = dict(id, ds, cams=[dict(c=<source cam>, crop=[x0,y0,x1,y1] in source px or None, scale=float, bright=None|(t0,t1,gain_end), offset_s=0.0)], start_s, dur_s)
Truth homographies map OUTPUT-video pixels -> floor metres."""
import json, sys, math
from pathlib import Path
import cv2, numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from calib import *
OUT = Path(__file__).resolve().parents[1] / "videos"
import subprocess, imageio_ffmpeg
class Writer:
    """VP8 .webm through ffmpeg (OpenCV's own writer cannot make webm here)"""
    def __init__(s, path, fps, size):
        s.p = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{size[0]}x{size[1]}", "-r", str(fps), "-i", "-",
                                "-c:v", "libvpx", "-crf", "12", "-b:v", "2M", "-cpu-used", "5", "-deadline", "good", "-pix_fmt", "yuv420p", "-g", "50", str(path)], stdin=subprocess.PIPE)
    def write(s, fr): s.p.stdin.write(np.ascontiguousarray(fr).tobytes())
    def release(s): s.p.stdin.close(); s.p.wait()
SCAN = DL / "scan"

def src_to_out(crop, scale):
    x0, y0, x1, y1 = crop
    return np.array([[scale, 0, -x0 * scale], [0, scale, -y0 * scale], [0, 0, 1.0]])   # source px -> output px

def foot_points(ds, c, f0, f1):
    """foot points (floor units) of YOLO detections of source cam c in frames [f0,f1)"""
    ci = cam_info(ds, c); sj = SCAN / (ci["video"].stem + ".json")
    if not sj.exists(): return np.zeros((0, 2))
    d = json.loads(sj.read_text()); pts = [((b[0] + b[2]) / 2, b[3]) for k, bs in d.items() if f0 <= int(k) < f1 for b in bs if b[3] > 110]
    return apply_H(ci["H"], pts) if pts else np.zeros((0, 2))

def cell_masks(ds, cams, crops, f0, f1, cell_m=0.2):
    """boolean visibility of each cam on a floor grid restricted to the walkable area (cells near YOLO foot points of any cam)"""
    cs = [cam_info(ds, c) for c in cams]; unit = cs[0]["unit_m"]; cell = cell_m / unit
    fp = np.vstack([foot_points(ds, c, f0, f1) for c in cams]) if cams else np.zeros((0, 2))
    if len(fp) == 0: return None
    lo, hi = np.percentile(fp, 5, 0), np.percentile(fp, 95, 0); span = hi - lo; lo, hi = lo - 0.3 * span - 10 * cell, hi + 0.3 * span + 10 * cell
    cell = max(cell, float(np.max(hi - lo)) / 500)
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0], cell), np.arange(lo[1], hi[1], cell)); G = np.c_[gx.ravel(), gy.ravel()]
    ij = np.floor((fp - lo) / cell).astype(int); occ = np.zeros(gx.shape, np.uint8)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < gx.shape[1]) & (ij[:, 1] >= 0) & (ij[:, 1] < gx.shape[0]); occ[ij[ok, 1], ij[ok, 0]] = 1
    occ = cv2.dilate(occ, np.ones((5, 5), np.uint8)).ravel() > 0
    vis = []
    for ci, crop in zip(cs, crops):
        Hi = np.linalg.inv(ci["H"]); h = Hi @ np.c_[G, np.ones(len(G))].T; w = h[2]
        px = (h[:2] / np.where(w == 0, 1e-9, w)).T; x0, y0, x1, y1 = crop
        cen = apply_H(ci["H"], [[(x0 + x1) / 2, (y0 + y1) / 2 + (y1 - y0) / 4]])[0]
        s = np.sign((Hi @ [cen[0], cen[1], 1])[2])
        vis.append((np.sign(w) == s) & (px[:, 0] >= x0) & (px[:, 0] < x1) & (px[:, 1] >= y0) & (px[:, 1] < y1))
    return [v & occ for v in vis], occ.sum()

def overlap_matrix(vis):
    n = len(vis); M = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            a, b = vis[i], vis[j]; M[i, j] = (a & b).sum() / max(1, min(a.sum(), b.sum()))
    return M

def classify(M):
    n = len(M); off = [M[i, j] for i in range(n) for j in range(i + 1, n)]
    if all(o >= 0.6 for o in off): return "full"
    if all(o <= 0.05 for o in off): return "none"
    return "partial"

def gain_at(bright, t):
    """bright = (t0, t1, g_end): gain falls linearly 1 -> g_end between t0..t1 s, then stays (synthetic lighting change)"""
    t0, t1, g = bright
    return 1.0 if t <= t0 else g if t >= t1 else 1 + (g - 1) * (t - t0) / (t1 - t0)

def build(spec, write=True):
    ds, sid = spec["ds"], spec["id"]; fps = 25.0; f0 = int(spec["start_s"] * fps); n = int(spec["dur_s"] * fps)
    d = OUT / sid; d.mkdir(parents=True, exist_ok=True); cams_truth = []; crops = []; cams = []
    for k, cs in enumerate(spec["cams"]):
        ci = cam_info(ds, cs["c"]); W, Hh = ci["size"]; crop = cs.get("crop") or [0, 0, W, Hh]; scale = cs.get("scale", 2.0)
        off = int(round(cs.get("offset_s", 0) * fps)); crops.append(crop); cams.append(cs["c"])
        ow, oh = int(round((crop[2] - crop[0]) * scale)) // 2 * 2, int(round((crop[3] - crop[1]) * scale)) // 2 * 2
        if write:
            cap = cv2.VideoCapture(str(ci["video"])); cap.set(1, f0 + off)
            vw = Writer(d / f"cam{k}.webm", fps, (ow, oh))
            for i in range(n):
                ok, fr = cap.read()
                if not ok: break
                fr = fr[crop[1]:crop[3], crop[0]:crop[2]]
                fr = cv2.resize(fr, (ow, oh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
                if cs.get("bright"):
                    g = gain_at(cs["bright"], i / fps); fr = np.clip(fr.astype(np.float32) * g * np.array([1.0, 1.0, 1.0 + 0.12 * (1 - g)]), 0, 255).astype(np.uint8)
                vw.write(fr)
            vw.release()
        T = src_to_out(crop, scale); H_out = np.diag([ci["unit_m"], ci["unit_m"], 1.0]) @ ci["H"] @ np.linalg.inv(T)
        cams_truth.append({"file": f"cam{k}.webm", "source_cam": cs["c"], "size": [ow, oh], "crop_src_px": crop, "scale": scale, "time_offset_s": cs.get("offset_s", 0.0),
                           "synthetic_lighting_change": cs.get("bright"), "H_img_to_floor_m": (H_out / H_out[2, 2]).tolist()})
    r = cell_masks(ds, cams, crops, f0, f0 + n); M = None; kind = None
    if r:
        vis, nocc = r; M = overlap_matrix(vis); kind = classify(M)
    truth = {"id": sid, "dataset": ds, "start_s_in_source": spec["start_s"], "duration_s": spec["dur_s"], "fps": fps, "cameras": cams_truth,
             "floor_unit_m": cam_info(ds, cams[0])["unit_m"], "scale_source": SCALE_SRC.get(ds, ""),
             "overlap_measured": kind, "overlap_matrix_shared_fraction_of_smaller_view": None if M is None else np.round(M, 3).tolist(),
             "gt_positions": gt_for(spec, f0, n, fps), "notes": spec.get("notes", ""), "floor_reference_hints": spec.get("hints", "")}
    if write: (d / "truth.json").write_text(json.dumps(truth, indent=1))
    return truth

SCALE_SRC = {"lab4p": "ESTIMATE: 1 calibration unit ~= 3 cm (EPFL gives no unit; matches rug 2.2x3.6 m guess and ~0.9 m/s walking speed); +/-30 %",
             "lab6p": "ESTIMATE: 1 calibration unit ~= 3 cm (as lab4p); +/-30 %", "passageway": "ESTIMATE: 1 unit ~= 5 cm from ~1 m/s walking speed; +/-40 %",
             "campus4": "ESTIMATE: 1 calibration unit ~= 1.8 cm (ratio to EPFL's Tsai metres, +/-30 %)", "campus7": "ESTIMATE: 1 calibration unit ~= 1.8 cm (as campus4), +/-30 %",
             "terrace1": "ESTIMATE: 1 calibration unit ~= 1.82 cm (0.86 cm from the Tsai-mm ratio x 2.12, rescaled because people measured on the page came out 0.8 m tall; basis: people ~1.7 m), +/-30 %", "terrace2": "ESTIMATE: 1 unit ~= 1.82 cm (as terrace1, basis people ~1.7 m), +/-30 %"}

def gt_for(spec, f0, n, fps):
    ds = spec["ds"]; key = {"lab6p": "lab6p", "passageway": "passageway"}.get(ds)
    if not key: return None
    gt, step = read_gt(EP / GT_SPEC[key][0], *GT_SPEC[key][1:]); u = cam_info(ds, spec["cams"][0]["c"])["unit_m"]
    return {"coordinate_frame": "same floor frame as the camera homographies (metres)", "cell_quantisation_m": None,
            "frames": [{"t": round((f - f0) / fps, 2), "people": [{"id": i, "x": round(x * u, 3), "y": round(y * u, 3)} for i, (x, y) in p.items()]}
                       for f, p in sorted(gt.items()) if f0 <= f < f0 + n]}

def counts(ds, c, crop=None):
    """{frame: persons whose box centre lies inside crop}"""
    ci = cam_info(ds, c); d = json.loads((SCAN / (ci["video"].stem + ".json")).read_text()); crop = crop or [0, 0, 360, 288]; x0, y0, x1, y1 = crop
    return {int(k): sum(1 for b in bs if x0 <= (b[0] + b[2]) / 2 < x1 and y0 <= (b[1] + b[3]) / 2 < y1 and (b[3] - b[1]) > 18) for k, bs in d.items()}

def best_window(ds, cams, crops, dur_s, lo_s=0, hi_s=None, need=2, prefer_mean=True):
    """start (s) where every cam has >=`need` people in the most sampled frames; returns (start_s, per-cam fraction, per-cam mean)"""
    cs = [counts(ds, c, cr) for c, cr in zip(cams, crops)]; fr = sorted(set.intersection(*[set(c) for c in cs])); best = None
    step = fr[1] - fr[0]; w = int(dur_s * 25 / step)
    for i in range(0, len(fr) - w):
        win = fr[i:i + w]
        if win[0] / 25 < lo_s or (hi_s and win[-1] / 25 > hi_s): continue
        fracs = [np.mean([c[f] >= need for f in win]) for c in cs]; means = [np.mean([c[f] for f in win]) for c in cs]
        score = min(fracs) + 0.05 * min(means)
        if best is None or score > best[0]: best = (score, win[0] / 25, [round(x, 2) for x in fracs], [round(x, 2) for x in means])
    return best[1:]
