"""Draw a test picture: 3 shelves (1.6 m x 0.6 m x 1.2 m) on a tiled floor, seen by a high camera at an angle.

Writes sample.png and sample_truth.json (true shelf floor positions in metres) so the prototype can be measured.
Run: ..\\NTT_Prototype\\.venv-vision\\Scripts\\python.exe -I make_sample.py
"""
import json
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
W, H = 960, 540
# Pinhole camera 2.8 m up, 3.5 m back from the shelf row, tilted down and turned a little.
f = 700.0
K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
cam = np.array([1.2, -3.2, 2.8])          # world: x along the row, y away from the camera, z up
target = np.array([3.4, 2.0, 0.3])
fwd = (target - cam) / np.linalg.norm(target - cam)
right = np.cross(fwd, [0, 0, 1]); right /= np.linalg.norm(right)
down = np.cross(fwd, right)
R = np.stack([right, down, fwd])


def to_image(p):
    c = R @ (np.asarray(p, float) - cam)
    u = K @ c
    return u[:2] / u[2]


img = np.full((H, W, 3), (70, 78, 74), np.uint8)
for gx in np.arange(-2, 10.01, 0.5):        # floor tiles every 0.5 m
    cv2.line(img, tuple(map(int, to_image([gx, -1, 0]))), tuple(map(int, to_image([gx, 9, 0]))), (88, 98, 92), 1, cv2.LINE_AA)
for gy in np.arange(-1, 9.01, 0.5):
    cv2.line(img, tuple(map(int, to_image([-2, gy, 0]))), tuple(map(int, to_image([10, gy, 0]))), (88, 98, 92), 1, cv2.LINE_AA)

truth = []
L, D, Hh = 1.6, 0.6, 1.2
for k, x0 in enumerate([0.5, 2.5, 4.5]):    # 2 m from start to start
    y0 = 2.0
    base = [[x0, y0, 0], [x0 + L, y0, 0], [x0 + L, y0 + D, 0], [x0, y0 + D, 0]]   # front-left, front-right, back-right, back-left
    top = [[x, y, Hh] for x, y, _ in base]
    faces = [([base[0], base[1], top[1], top[0]], (60, 80, 175)),   # front (facing camera)
             ([base[1], base[2], top[2], top[1]], (45, 60, 140)),   # right side
             ([base[0], base[3], top[3], top[0]], (45, 60, 140)),   # left side
             (top, (95, 120, 210))]                                  # top
    faces.sort(key=lambda face: -np.mean([np.linalg.norm(np.asarray(p) - cam) for p in face[0]]))  # far faces first
    for pts, colour in faces:
        cv2.fillPoly(img, [np.array([to_image(p) for p in pts], np.int32)], colour, cv2.LINE_AA)
    for row in (0.35, 0.7, 1.05):               # product rows on the front
        a, b = to_image([x0 + 0.05, y0, row]), to_image([x0 + L - 0.05, y0, row])
        cv2.line(img, tuple(map(int, a)), tuple(map(int, b)), (150, 175, 220), 2, cv2.LINE_AA)
    truth.append({"name": f"Shelf {k + 1}", "corners_m": [[x, y] for x, y, _ in base], "corners_px": [to_image(p).round(1).tolist() for p in base]})

img = cv2.add(img, np.random.default_rng(3).integers(0, 10, img.shape, dtype=np.uint8))

# People: a person cut from the app's demo photo, scaled to 1.7 m tall, standing at known floor spots.
people = [{"where": "inside", "floor_m": [6.9, 0.3]}, {"where": "outside", "floor_m": [8.8, 3.4]}]  # not in front of any shelf
photo = cv2.imread(str(HERE.parent / "NTT_Prototype/data/vision/demo-people.jpg"))
if photo is not None:
    person = photo[42:711, 760:1140]
    for p in people:
        foot, head = to_image([*p["floor_m"], 0]), to_image([*p["floor_m"], 1.7])
        h = int(np.linalg.norm(foot - head)); w = int(h * person.shape[1] / person.shape[0])
        x, y = int(foot[0] - w / 2), int(foot[1] - h)
        crop = cv2.resize(person, (w, h))
        y0, x0 = max(0, y), max(0, x)
        img[y0:y + h, x0:x + w] = crop[y0 - y:, x0 - x:][: H - y0, : W - x0]
        p["foot_px"] = foot.round(1).tolist()
cv2.imwrite(str(HERE / "sample.png"), img)
(HERE / "sample_truth.json").write_text(json.dumps(truth, indent=1))
(HERE / "sample_people.json").write_text(json.dumps(people, indent=1))
print("wrote sample.png", [t["corners_px"][0] for t in truth])
