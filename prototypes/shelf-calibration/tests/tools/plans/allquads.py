import sys, json; sys.path.insert(0, 'C:/Users/User/OneDrive/Desktop/nttdata_cam/shelf-calibration-prototype/tests/tools'); sys.path.insert(0, 'C:/Users/User/OneDrive/Desktop/nttdata_cam/shelf-calibration-prototype/tests/tools/plans')
from quads import *
from build_wt import wt_H, WT
OUT = {}
for ds, cams, ymin in (("lab4p", range(4), 120), ("lab6p", range(4), 120), ("terrace1", range(4), 140), ("terrace2", range(4), 140), ("campus4", range(3), 140), ("passageway", range(4), 140)):
    for c in cams:
        ci = cam_info(ds, c); bg = background(ci["video"]) if not (ds in ("lab4p",) ) else background(ci["video"]); cv2.imwrite(f"tools/scratch/bg_{ds}_{c}.png", bg)
        r = quads(bg, ci["H"], ci["unit_m"], ymin, maxd=2.0 if ds.startswith("lab") else 3.0)
        OUT[f"{ds}:{c}"] = r; print(ds, c, r["n"], None if r["basis"] is None else np.round(r["basis"], 2).tolist(), len(r.get("quads", [])), flush=True)
for c in range(1, 8):
    imgs = [cv2.resize(cv2.imread(str(WT / "Image_subsets" / f"C{c}" / f"{k*5:08d}.png")), None, fx=.5, fy=.5, interpolation=cv2.INTER_AREA) for k in range(0, 40, 2)]
    bg = np.median(np.array(imgs), 0).astype(np.uint8); cv2.imwrite(f"tools/scratch/bg_wt_{c}.png", bg)
    H = wt_H(c) @ np.diag([2.0, 2.0, 1.0]); r = quads(bg, H, 1.0, 230, mind=0.4, maxd=6.0, size_tol=0.15)
    OUT[f"wt:{c}"] = r; print("wt", c, r["n"], None if r["basis"] is None else np.round(r["basis"], 2).tolist(), len(r.get("quads", [])), flush=True)
json.dump(OUT, open("tools/plans/quads_all.json", "w"))
