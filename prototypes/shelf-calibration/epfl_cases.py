r"""Build the 2-camera test cases from the EPFL lab sequence (research use) using EPFL's own floor calibration as truth.

- Finds the blue carpet's outline on the floor (blue pixels of all 4 cameras projected to the floor, majority vote).
- Chooses crops of camera 0 ("camera 1" in the page) and camera 1 ("camera 2") for:
  case 1 = camera 2 sees only floor camera 1 also sees, case 2 = no shared floor, case 3 = about half shared.
- Writes epfl_lab/cases.json and cropped 60-s clips epfl_lab/c1_caseN.webm, c2_caseN.webm.
Run: ..\NTT_Prototype\.venv-vision\Scripts\python.exe -I epfl_cases.py [--analyse-only]
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
D = HERE / "epfl_lab"
H = {0: [[0.176138, 0.647589, -63.412272], [-0.180912, 0.622446, -0.125533], [-0.000002, 0.001756, 0.102316]],
     1: [[0.177291, 0.004724, 31.224545], [0.169895, 0.661935, -79.781865], [-0.000028, 0.001888, 0.054634]],
     2: [[-0.118791, 0.077787, 64.819189], [0.133127, 0.069884, 15.832922], [-0.000001, 0.002045, -0.057759]],
     3: [[-0.142865, 0.553150, -17.395045], [-0.125726, 0.039770, 75.937144], [-0.000011, 0.001780, 0.015675]]}
H = {k: np.array(v) for k, v in H.items()}
W, Hh = 360, 288
to_ground = lambda c, pts: cv2.perspectiveTransform(np.float32(pts).reshape(-1, 1, 2), H[c]).reshape(-1, 2)
to_image = lambda c, pts: cv2.perspectiveTransform(np.float32(pts).reshape(-1, 1, 2), np.linalg.inv(H[c])).reshape(-1, 2)

# ---- carpet: blue on the floor, voted over the 4 cameras
G0, GS = -60, 480  # ground raster: units -60..420, 1 unit per cell
votes, seen = np.zeros((GS, GS)), np.zeros((GS, GS))
gy, gx = np.mgrid[0:GS, 0:GS]
cells = np.stack([gx.ravel() + G0, gy.ravel() + G0], 1).astype(np.float32)
for c in range(4):
    img = cv2.imread(str(D / f"cam{c}-first.png"))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    blue = ((hsv[..., 0] > 95) & (hsv[..., 0] < 130) & (hsv[..., 1] > 60) & (hsv[..., 2] > 50)).astype(np.uint8)
    px = to_image(c, cells)
    # only cells in front of the camera and inside the picture
    den = (np.linalg.inv(H[c]) @ np.c_[cells, np.ones(len(cells))].T)[2]
    ok = (den > 0) & (px[:, 0] >= 0) & (px[:, 0] < W - 1) & (px[:, 1] >= 0) & (px[:, 1] < Hh - 1)
    v = np.zeros(len(cells)); v[ok] = blue[px[ok, 1].astype(int), px[ok, 0].astype(int)]
    votes += v.reshape(GS, GS); seen += ok.reshape(GS, GS)
mask = ((seen > 0) & (votes / np.maximum(seen, 1) > 0.5)).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(mask)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
pts = np.argwhere(lab == big)[:, ::-1].astype(np.float32) + G0
(cx, cy), (w, h), ang = cv2.minAreaRect(pts)
carpet = cv2.boxPoints(((cx, cy), (w, h), ang)).tolist()
print(f"carpet: {w:.0f} x {h:.0f} units, fill {len(pts) / (w * h):.2f}, corners {np.round(carpet).tolist()}")

# rug: the 4 floor corners clicked in camera 0 (same as the page test)
rug = to_ground(0, [[130, 90], [186, 114], [41, 176], [6, 131]])
print("rug corners (ground):", np.round(rug, 1).tolist())

# ---- crops: how much of camera 2's floor (inside the room) is also on camera 1's floor
room = cv2.boundingRect(np.float32(np.vstack([carpet, rug])))  # floor area people use
rx, ry, rw, rh = room
grid = np.stack(np.meshgrid(np.arange(rx, rx + rw, 4.0), np.arange(ry, ry + rh, 4.0)), -1).reshape(-1, 2).astype(np.float32)
def visible(c, crop):
    px = to_image(c, grid); x0, y0, x1, y1 = crop
    return (px[:, 0] >= x0) & (px[:, 0] < x1) & (px[:, 1] >= y0) & (px[:, 1] < y1)
def overlap(c1crop, c2crop):
    a, b = visible(0, c1crop), visible(1, c2crop)
    return (a & b).sum() / max(1, b.sum()), b.sum()
if "--search" in sys.argv:
    best = {}
    for x0 in range(0, 240, 20):
        for x1 in range(x0 + 120, 361, 20):
            for y0 in range(0, 168, 20):
                for y1 in range(y0 + 100, 289, 20):
                    for crop1 in ([0, 0, 360, 288], [0, 0, 200, 288], [0, 60, 360, 288], [0, 0, 260, 288]):
                        o, nb = overlap(crop1, [x0, y0, x1, y1])
                        for case, target in ((1, 1.0), (2, 0.0), (3, 0.5)):
                            score = abs(o - target) - nb / 20000
                            if case not in best or score < best[case][0]:
                                best[case] = (score, crop1, [x0, y0, x1, y1], round(o, 2), int(nb))
    for k, v in best.items(): print("case", k, "camera-1 crop", v[1], "camera-2 crop", v[2], "shared", v[3], "floor cells", v[4])
json.dump({"carpet_ground": carpet, "rug_ground": rug.tolist(), "room": room}, open(D / "truth.json", "w"))

# ---- case files
# The page builds its map from the rug clicked in camera 1: front-left corner = (0, W), front-right = (L, W), back-right = (L, 0),
# back-left = (0, 0), L = 3.6 m, W = 2.2 m (EPFL gives no units; this matches ~3 cm per unit). The carpet is put on that map as a
# "floor plan" item, the way a store's floor plan would give it.
L, Wd = 3.6, 2.2
rug_order = np.float32([rug[2], rug[1], rug[0], rug[3]])  # order the page uses for these 4 clicks (checked in the page)
to_map = cv2.getPerspectiveTransform(rug_order, np.float32([[0, Wd], [L, Wd], [L, 0], [0, 0]]))
carpet_map = cv2.perspectiveTransform(np.float32(carpet).reshape(-1, 1, 2), to_map).reshape(-1, 2)
cases = {"1": {"crop1": [0, 0, 360, 288], "crop2": [0, 120, 300, 280]},
         "2": {"crop1": [0, 0, 200, 288], "crop2": [0, 0, 360, 150]},
         "3": {"crop1": [0, 0, 200, 288], "crop2": [80, 0, 360, 260]}}
for k, c in cases.items():
    c["shared"] = round(float(overlap(c["crop1"], c["crop2"])[0]), 2)
info = {"H0": H[0].ravel().tolist(), "H1": H[1].ravel().tolist(), "rug_clicks_cam1": [[130, 90], [186, 114], [41, 176], [6, 131]],
        "size": [L, Wd], "carpet_map": carpet_map.round(3).tolist(), "carpet_ground": carpet, "cases": cases}
(D / "cases.json").write_text(json.dumps(info, indent=1))
print("carpet on the map (m):", carpet_map.round(2).tolist())
if "--analyse-only" in sys.argv or "--search" in sys.argv:
    sys.exit()
FRAMES = 1500  # 60 s at 25 fps
for k, c in cases.items():
    for cam, crop, name in ((0, c["crop1"], f"c1_case{k}.webm"), (1, c["crop2"], f"c2_case{k}.webm")):
        if crop == [0, 0, 360, 288] and False: continue
        x0, y0, x1, y1 = crop
        cap = cv2.VideoCapture(str(D / f"4p-c{cam}.avi"))
        out = cv2.VideoWriter(str(D / name), cv2.VideoWriter_fourcc(*"VP80"), 25, (x1 - x0, y1 - y0))
        for _ in range(FRAMES):
            ok, f = cap.read()
            if not ok: break
            out.write(np.ascontiguousarray(f[y0:y1, x0:x1]))
        out.release(); print("wrote", name, x1 - x0, "x", y1 - y0)
