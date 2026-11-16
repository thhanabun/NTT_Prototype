"""Dev tool: how far is each detection's floor point (box bottom centre, truth calibration) from the nearest real person?
Split by box state, to see which detections to trust. usage: foot_error.py <scenario> <rec.json>"""
import json, sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent.parent
sc, recp = sys.argv[1:3]
t = json.load(open(HERE / "videos" / sc / "truth.json", encoding="utf-8")); rec = json.load(open(recp, encoding="utf-8"))
Hs = [np.array(c["H_img_to_floor_m"]) for c in t["cameras"]]; W, Hh = t["cameras"][0]["size"]
fr = t["gt_positions"]["frames"]; gt_t = np.array([f["t"] for f in fr])


def gt_at(sec):  # linear interpolation of each GT id between 1 Hz frames
    i = np.searchsorted(gt_t, sec); i0, i1 = max(0, i - 1), min(len(fr) - 1, i)
    a, b = {p["id"]: (p["x"], p["y"]) for p in fr[i0]["people"]}, {p["id"]: (p["x"], p["y"]) for p in fr[i1]["people"]}
    w = 0 if i0 == i1 else (sec - gt_t[i0]) / (gt_t[i1] - gt_t[i0])
    return np.array([[(1 - w) * a[k][0] + w * b[k][0], (1 - w) * a[k][1] + w * b[k][1]] for k in a if k in b])


def to_floor(H, x):
    q = H @ [x[0], x[1], 1]; return q[:2] / q[2]


rows = []
for r in rec:
    sec = r["now"] / 1000; g = gt_at(sec)
    if not len(g): continue
    for ci, ppl in r["cams"].items():
        H = Hs[int(ci)]; boxes = [p["box"] for p in ppl]
        for k, b in enumerate(boxes):
            w, h = b[2] - b[0], b[3] - b[1]; foot = to_floor(H, [(b[0] + b[2]) / 2, b[3]])
            e = float(np.min(np.linalg.norm(g - foot, axis=1)))
            # bottom hidden: another box overlaps this box's lower half and reaches lower in the picture (stands in front)
            hidden = any(j != k and o[3] > b[3] + 3 and min(o[2], b[2]) - max(o[0], b[0]) > .3 * w and o[1] < b[3] for j, o in enumerate(boxes))
            edge = b[3] > Hh - 4
            rows.append((e, h / max(1, w), hidden, edge, h))
E = np.array([r[0] for r in rows]); asp = np.array([r[1] for r in rows]); hid = np.array([r[2] for r in rows]); edge = np.array([r[3] for r in rows])
def s(m, name): print(f"{name:28s} n={m.sum():5d}  median {np.median(E[m]):.2f}  p75 {np.percentile(E[m], 75):.2f}  p90 {np.percentile(E[m], 90):.2f}") if m.sum() else print(name, 0)
s(np.ones(len(E), bool), "all")
s(~hid & ~edge, "bottom visible")
s(hid, "bottom hidden by a nearer box")
s(edge, "cut by picture bottom")
for lo, hi in ((0, 1.8), (1.8, 2.4), (2.4, 9)): s((asp >= lo) & (asp < hi) & ~hid & ~edge, f"visible, aspect {lo}-{hi}")
