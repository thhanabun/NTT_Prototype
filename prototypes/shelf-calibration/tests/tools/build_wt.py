"""WILDTRACK (EPFL CVLab / IDIAP, research use) scenarios: 1920x1080 PNG frames at 2 fps -> webm, truth in metres.
spec = dict(id, a=first annotated frame number (0..), n=frames, cams=[dict(c=1..7, crop=[x0,y0,x1,y1] or None, scale)] )"""
import json, sys
from pathlib import Path
import cv2, numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import overlap_matrix, classify, src_to_out, OUT, Writer
from calib import DL, apply_H
WT = DL / "wildtrack" / "Wildtrack_dataset"; NAMES = ["CVLab1", "CVLab2", "CVLab3", "CVLab4", "IDIAP1", "IDIAP2", "IDIAP3"]
LICENCE_WT = "WILDTRACK, CVLab EPFL + IDIAP, research use only (Chavdarova et al., CVPR 2018); https://www.epfl.ch/labs/cvlab/data/data-wildtrack/"

def wt_H(c):
    """pixel (1920x1080 undistorted) -> floor in metres, X = -3 + 0.025*(id%480), Y = -9 + 0.025*(id//480)"""
    import re
    t = open(WT / "calibrations/extrinsic" / f"extr_{NAMES[c-1]}.xml").read()
    g = lambda k: np.array(re.search(f"<{k}>([^<]*)</{k}>", t, re.S).group(1).split(), float)
    rvec, tvec = g("rvec"), g("tvec")
    i = cv2.FileStorage(str(WT / "calibrations/intrinsic_zero" / f"intr_{NAMES[c-1]}.xml"), cv2.FILE_STORAGE_READ); K = i.getNode("camera_matrix").mat()
    R, _ = cv2.Rodrigues(rvec); M = K @ np.c_[R[:, 0], R[:, 1], tvec]     # floor (cm) -> pixel
    S = np.diag([100.0, 100.0, 1.0])                                        # metres -> cm
    return np.diag([1.0, -1.0, 1.0]) @ np.linalg.inv(M @ S)                # pixel -> floor metres, y FLIPPED (page frame: x right, y down; the dataset frame is mirrored w.r.t. it)

def gt_frames(a, n):
    out = []
    for k in range(a, a + n):
        d = json.loads((WT / "annotations_positions" / f"{k*5:08d}.json").read_text())
        out.append([(p["personID"], -3.0 + 0.025 * (p["positionID"] % 480), -(-9.0 + 0.025 * (p["positionID"] // 480)), p["views"]) for p in d])
    return out

def build_wt(spec, write=True):
    sid, a, n = spec["id"], spec["a"], spec["n"]; d = OUT / sid; d.mkdir(parents=True, exist_ok=True); fps = 2.0; ct = []; crops = []; Hs = []
    for k, cs in enumerate(spec["cams"]):
        c = cs["c"]; crop = cs.get("crop") or [0, 0, 1920, 1080]; sc = cs.get("scale", 0.5); crops.append(crop); H = wt_H(c); Hs.append(H)
        ow, oh = int(round((crop[2] - crop[0]) * sc)) // 2 * 2, int(round((crop[3] - crop[1]) * sc)) // 2 * 2
        if write:
            vw = Writer(d / f"cam{k}.webm", fps, (ow, oh))
            for j in range(a, a + n):
                im = cv2.imread(str(WT / "Image_subsets" / f"C{c}" / f"{j*5:08d}.png")); im = im[crop[1]:crop[3], crop[0]:crop[2]]
                if cs.get("bright"):
                    t0, t1, g = cs["bright"]; t = (j - a) / fps; gg = 1 if t <= t0 else g if t >= t1 else 1 + (g - 1) * (t - t0) / (t1 - t0)
                    im = np.clip(im.astype(np.float32) * gg * np.array([1, 1, 1 + .12 * (1 - gg)]), 0, 255).astype(np.uint8)
                vw.write(cv2.resize(im, (ow, oh), interpolation=cv2.INTER_AREA))
            vw.release()
        T = src_to_out(crop, sc); Ho = H @ np.linalg.inv(T)
        ct.append({"file": f"cam{k}.webm", "source_cam": f"C{c} ({NAMES[c-1]})", "size": [ow, oh], "crop_src_px": crop, "scale": sc, "time_offset_s": 0.0,
                   "synthetic_lighting_change": cs.get("bright"), "H_img_to_floor_m": (Ho / Ho[2, 2]).tolist()})
    G = gt_frames(a, n); pts = np.array([[x, y] for fr in G for _, x, y, _ in fr]); cell = 0.25
    lo = pts.min(0) - 1; hi = pts.max(0) + 1; gx, gy = np.meshgrid(np.arange(lo[0], hi[0], cell), np.arange(lo[1], hi[1], cell)); Gc = np.c_[gx.ravel(), gy.ravel()]
    occ = np.zeros(gx.shape, np.uint8); ij = np.floor((pts - lo) / cell).astype(int); occ[ij[:, 1], ij[:, 0]] = 1; occ = cv2.dilate(occ, np.ones((5, 5), np.uint8)).ravel() > 0
    vis = []
    for H, crop in zip(Hs, crops):
        Hi = np.linalg.inv(H); h = Hi @ np.c_[Gc, np.ones(len(Gc))].T; w = h[2]; px = (h[:2] / np.where(w == 0, 1e-9, w)).T
        vis.append((w > 0) & (px[:, 0] >= crop[0]) & (px[:, 0] < crop[2]) & (px[:, 1] >= crop[1]) & (px[:, 1] < crop[3]) & occ)
    M = overlap_matrix(vis)
    # people visible per camera crop (annotated boxes centre inside crop)
    pc = []
    for cs_, crop in zip(spec["cams"], crops):
        v = [sum(1 for _, _, _, views in fr for vw_ in views if vw_["viewNum"] == cs_["c"] - 1 and vw_["xmin"] != -1 and crop[0] <= (vw_["xmin"] + vw_["xmax"]) / 2 < crop[2] and crop[1] <= (vw_["ymin"] + vw_["ymax"]) / 2 < crop[3]) for fr in G]
        pc.append(round(float(np.mean(v)), 1))
    truth = {"id": sid, "dataset": "wildtrack", "start_frame_10fps": a * 5, "duration_s": n / fps, "fps": fps, "cameras": ct, "floor_unit_m": 1.0,
             "scale_source": "metres (WILDTRACK calibration, exact)", "overlap_measured": classify(M), "overlap_matrix_shared_fraction_of_smaller_view": np.round(M, 3).tolist(),
             "mean_annotated_people_per_camera_view": pc,
             "gt_positions": {"coordinate_frame": "same floor frame as the camera homographies (metres)", "cell_quantisation_m": 0.025,
                              "frames": [{"t": round(i / fps, 2), "people": [{"id": pid, "x": round(x, 3), "y": round(y, 3)} for pid, x, y, _ in fr]} for i, fr in enumerate(G)]},
             "notes": spec.get("notes", ""), "floor_reference_hints": spec.get("hints", "")}
    if write: (d / "truth.json").write_text(json.dumps(truth, indent=1))
    return truth
