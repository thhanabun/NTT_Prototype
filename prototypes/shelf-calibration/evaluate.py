"""Measure the prototype on sample.png against sample_truth.json (same steps as the page, without a browser).

Run: ..\\NTT_Prototype\\.venv-vision\\Scripts\\python.exe -I evaluate.py [grabcut|sam]
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # run with -I, so add this folder explicitly
import server  # noqa: E402
method = sys.argv[1] if len(sys.argv) > 1 else "grabcut"
image = cv2.imread(str(HERE / "sample.png"))
truth = json.loads((HERE / "sample_truth.json").read_text())
boxes = {"Shelf 2 (middle, reference)": ([340, 130, 565, 335], 1), "Shelf 3 (right)": ([545, 120, 750, 295], 2), "Shelf 1 (left)": ([75, 155, 345, 385], 0)}
L, W = 1.6, 0.6

found = {}
for name, (box, k) in boxes.items():
    result = server.analyse(image, box, method)
    found[name] = (result, truth[k])
    true_px = np.array(truth[k]["corners_px"])
    if result["corners"]:
        hidden = np.array(result["corners"][2])
        poly = np.array(result["outline"])
        parallelogram = np.array(result["corners"][1]) + np.array(result["corners"][3]) - np.array(result["corners"][0])
        err = np.linalg.norm(true_px - hidden, axis=1).min()
        err_par = np.linalg.norm(true_px - parallelogram, axis=1).min()
        print(f"{name}: hidden back corner off {err:.1f} px (parallelogram guess: {err_par:.1f} px)")
    else:
        print(f"{name}: front only")

# Camera -> floor metres from the reference shelf, then every shelf's centre and size.
ref = np.array(found["Shelf 2 (middle, reference)"][0]["corners"], np.float32)
H = cv2.getPerspectiveTransform(ref, np.float32([[0, W], [L, W], [L, 0], [0, 0]]))
to_floor = lambda pts: cv2.perspectiveTransform(np.float32(pts).reshape(-1, 1, 2), H).reshape(-1, 2)
def right_angle(c, tolerance=25):
    """A real shelf's floor corner is 90 degrees; a wrong 'side' reading is not."""
    a, b = c[1] - c[0], c[3] - c[0]
    angle = np.degrees(np.arccos(np.clip(a @ b / np.linalg.norm(a) / np.linalg.norm(b), -1, 1)))
    return abs(angle - 90) <= tolerance


def plausible(c):
    """Square corner and a depth within 50% of the reference (shelves in one store share a standard depth)."""
    depth = min(np.linalg.norm(c[1] - c[0]), np.linalg.norm(c[3] - c[0]))
    return right_angle(c) and abs(depth - W) <= 0.5 * W


centres, true_centres = {}, {}
for name, (result, t) in found.items():
    corners = to_floor(result["corners"]) if result["corners"] else None
    if corners is not None and name != "Shelf 2 (middle, reference)" and not plausible(corners):
        print(f"{name}: floor corners not square or depth far from the reference -> treated as front only")
        corners = None
    if corners is None:  # front only: reference depth, away from the camera (towards smaller floor y in this frame)
        f0, f1 = to_floor(result["front"])  # noqa: F841
        u = (f1 - f0) / np.linalg.norm(f1 - f0)
        n = np.array([u[1], -u[0]]) if u[0] > 0 else np.array([-u[1], u[0]])
        corners = np.array([f0, f1, f1 + n * W, f0 + n * W])
    size = sorted([np.linalg.norm(corners[1] - corners[0]), np.linalg.norm(corners[2] - corners[1])], reverse=True)
    centres[name], true_centres[name] = corners.mean(axis=0), np.mean(t["corners_m"], axis=0)
    print(f"{name}: size {size[0]:.2f} x {size[1]:.2f} m (true 1.60 x 0.60)")
names = list(centres)
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        a, b = names[i], names[j]
        print(f"distance {a.split(' (')[0]} - {b.split(' (')[0]}: {np.linalg.norm(centres[a] - centres[b]):.2f} m "
              f"(true {np.linalg.norm(true_centres[a] - true_centres[b]):.2f})")
