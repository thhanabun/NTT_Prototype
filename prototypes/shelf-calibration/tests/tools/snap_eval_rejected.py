"""Dev check: does snapping a clicked corner to the nearest image corner make it more accurate? (truth used for scoring only)
For each scenario camera: plan reference corners -> picture via truth; simulated clicks = truth +- up to N px; snap; floor error before/after.
usage: snap_eval.py <scenario> [<scenario> ...]"""
import json, sys
from pathlib import Path
import cv2, numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE.parent)); import server  # noqa: E402
rng = np.random.default_rng(0)
tot = {"before": [], "after": [], "snapped": 0, "n": 0}
for sc in sys.argv[1:]:
    t = json.load(open(HERE / "videos" / sc / "truth.json", encoding="utf-8")); plan = json.load(open(HERE / "videos" / sc / "floorplan.json", encoding="utf-8"))
    for ci, cam in enumerate(t["cameras"]):
        H = np.array(cam["H_img_to_floor_m"]); G = np.linalg.inv(H); w, h = cam["size"]
        cap = cv2.VideoCapture(str(HERE / "videos" / sc / cam["file"])); ok, img = cap.read()
        if not ok: continue
        for ref in plan["references"]:
            for X in ref.get("points_m", []):
                q = G @ [X[0], X[1], 1]
                if q[2] <= 0: continue
                p = q[:2] / q[2]
                if not (15 < p[0] < w - 15 and 15 < p[1] < h - 15): continue
                for _ in range(3):
                    click = p + rng.uniform(-8, 8, 2)
                    s = server.snap_corner(img, click, 10)
                    fl = lambda x: (H @ [x[0], x[1], 1])[:2] / (H @ [x[0], x[1], 1])[2]
                    e0 = float(np.linalg.norm(fl(click) - X)); e1 = float(np.linalg.norm(fl(s) - X)) if s else e0
                    tot["before"].append(e0); tot["after"].append(e1); tot["snapped"] += bool(s); tot["n"] += 1
b, a = np.array(tot["before"]), np.array(tot["after"])
print(f"corners x3 clicks: {tot['n']}, snapped {tot['snapped']} ({tot['snapped'] / max(1, tot['n']):.0%})")
print(f"floor error median before {np.median(b):.2f} m, after {np.median(a):.2f} m; p90 before {np.percentile(b, 90):.2f}, after {np.percentile(a, 90):.2f}; got worse in {np.mean(a > b + .05):.0%}")
