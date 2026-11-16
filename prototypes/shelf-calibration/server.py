"""Throwaway prototype: drag a box around a shelf -> shelf outline -> 4 floor corners.

Run with the vision env from the repo (has OpenCV, numpy, ultralytics):
    ..\\NTT_Prototype\\.venv-vision\\Scripts\\python.exe -I server.py        # http://127.0.0.1:8090
    ..\\NTT_Prototype\\.venv-vision\\Scripts\\python.exe -I server.py --selftest
"""
import argparse
import base64
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
SAM_WEIGHTS = HERE / "mobile_sam.pt"
YOLO_WEIGHTS = HERE.parent / "NTT_Prototype/data/vision/yolo11n.pt"  # already downloaded by the app's vision setup
YOLO_OPENVINO = HERE.parent / "NTT_Prototype/data/vision/yolo11n_openvino_model"  # same model exported for Intel CPUs (~3x faster)
_sam = None
_yolo = None


_trackers = {}  # camera -> (model with its own tracker state, settings)
TUNED_TRACKER = HERE / "tracker_lowfps.yaml"


def video_sets():
    """Folders in tests/videos that hold camera .webm files: what a user would pick as one recording session."""
    root = HERE / "tests" / "videos"
    titles = {}
    try:
        for s in json.loads((HERE / "tests" / "scenarios.json").read_text(encoding="utf-8")):
            titles[s["id"]] = s.get("title", s["id"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    out = []
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        files = sorted(f.name for f in d.glob("*.webm"))
        if d.is_dir() and files:
            out.append({"id": d.name, "title": titles.get(d.name, d.name), "files": files})
    return out


def yolo_model(fast):
    """OpenVINO export when asked for and present (pip install openvino; YOLO("yolo11n.pt").export(format="openvino")), else PyTorch."""
    from ultralytics import YOLO
    if fast and YOLO_OPENVINO.is_dir():
        return YOLO(str(YOLO_OPENVINO), task="detect")
    return YOLO(str(YOLO_WEIGHTS))


REID_XML = HERE.parent / "NTT_Prototype/data/vision/reid/person-reidentification-retail-0286.xml"  # OpenVINO Open Model Zoo, Apache-2.0
_reid = {"model": None, "local": threading.local()}
_emb_cache = {}  # (camera, track id) -> time of the last embedding sent
REID_EVERY_S = 0.3  # one appearance vector per tracked person per camera at most this often (~6 ms each on CPU)


def reid_vec(image, box):
    """256-number appearance vector of one person (unit length; same person across cameras ~0.6, different ~0.2)."""
    if _reid["model"] is None:  # loaded once at start (loading OpenVINO models from several threads at once can hang)
        return None
    req = getattr(_reid["local"], "req", None)
    if req is None:
        req = _reid["local"].req = _reid["model"].create_infer_request()
    x1, y1, x2, y2 = [int(round(v)) for v in box]
    crop = image[max(0, y1):max(0, y2), max(0, x1):max(0, x2)]
    if crop.size == 0:
        return None
    req.infer({0: cv2.resize(crop, (128, 256)).transpose(2, 0, 1)[None].astype(np.float32)})
    v = req.get_output_tensor(0).data.ravel()
    return (v / (np.linalg.norm(v) + 1e-9)).round(3).tolist()


_pool = []  # models loaded in advance so a new camera does not wait several seconds for its first frame


def _spare(fast):
    try:
        return _pool.pop() if fast else yolo_model(fast)
    except IndexError:
        return yolo_model(fast)


def people(image, track=False, reset=False, tuned=False, fast=True, camera="1", vt=None):
    """Person boxes (YOLO11n, COCO class 0). With track=True, ByteTrack gives each person a stable id across video frames;
    reset=True starts a new video (new ids). Each camera keeps its own tracker."""
    global _yolo
    if not YOLO_WEIGHTS.is_file():
        raise ValueError("yolo11n.pt not found; run the app's vision setup once")
    if not track:
        _yolo = _yolo or yolo_model(True)
        result = _yolo.predict(image, classes=[0], conf=0.3, imgsz=640, device="cpu", verbose=False)[0]
    else:
        cfg = (str(TUNED_TRACKER) if tuned else "bytetrack.yaml", fast)
        old = _trackers.get(camera)
        if old and old[1] == cfg and reset and getattr(old[0].predictor, "trackers", None):
            for t in old[0].predictor.trackers:  # same settings: clear the tracker instead of loading the model again
                t.reset()
        elif not old or old[1] != cfg:
            _trackers[camera] = (_spare(fast), cfg)  # own model instance = own tracker state
        result = _trackers[camera][0].track(image, persist=True, tracker=cfg[0], classes=[0], conf=0.3, imgsz=640, device="cpu", verbose=False)[0]
    ids = result.boxes.id.tolist() if track and result.boxes.id is not None else [None] * len(result.boxes)
    boxes = [b.xyxy[0].tolist() for b in result.boxes]
    out, now = [], (vt if vt is not None else time.monotonic())  # video time when the page sends it: same result every run
    for b, i, box in zip(result.boxes, ids, boxes):
        p = {"box": [round(v, 1) for v in box], "confidence": round(float(b.conf), 3), **({"id": int(i)} if i is not None else {}), "look": looks(image, box)}
        key = (camera, None if i is None else int(i))
        last = _emb_cache.get(key)
        if track and i is not None and box[3] - box[1] >= 48 and (last is None or now < last or now - last >= REID_EVERY_S):  # time going back = a rewind
            p["emb"] = reid_vec(image, box); _emb_cache[key] = now
        out.append(p)
    return out


def looks(image, box):
    """Clothing colour signature of one person: hue x saturation histograms of the upper body and the legs (brightness left
    out, so the same shirt matches across cameras with different exposure). Compared on the page to re-find people."""
    H, W = image.shape[:2]
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    ox, oy = int(max(0, x1)), int(max(0, y1))  # convert only this person's box, not the whole picture (15 people: 15 full-frame conversions)
    hsv = cv2.cvtColor(image[oy:int(min(H, max(oy + 1, y2))), ox:int(min(W, max(ox + 1, x2)))], cv2.COLOR_BGR2HSV)
    x1, y1, x2, y2 = x1 - ox, y1 - oy, x2 - ox, y2 - oy
    out = []
    for top, bottom in ((.18, .5), (.52, .88)):  # skip head/background at the sides and the feet
        part = hsv[int(max(0, y1 + top * h)):int(max(0, y1 + bottom * h)), int(max(0, x1 + .25 * w)):int(max(0, x2 - .25 * w))]
        if part.size == 0:
            return None
        grey = (part[..., 1] < 40) | (part[..., 2] < 40)  # black/white/grey: hue is noise there, count them by brightness
        hist = cv2.calcHist([part], [0, 1], (~grey).astype(np.uint8), [8, 3], [0, 180, 40, 256]).ravel()
        dark = np.count_nonzero(grey & (part[..., 2] < 90)); light = np.count_nonzero(grey) - dark
        v = np.concatenate([hist, [dark, light]]).astype(float)
        out += (v / max(1.0, v.sum())).round(3).tolist()
    return out


def segment(image, box, method):
    """Mask of the object inside the box. GrabCut needs no download; MobileSAM is used when its weights are present."""
    x1, y1, x2, y2 = [int(round(v)) for v in box]
    h, w = image.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w - 1, x2), min(h - 1, y2)
    if x2 - x1 < 8 or y2 - y1 < 8:
        raise ValueError("Box is too small")
    if method == "sam":
        global _sam
        if not SAM_WEIGHTS.is_file():
            raise ValueError("mobile_sam.pt is not downloaded yet; use GrabCut")
        if _sam is None:
            from ultralytics import SAM
            _sam = SAM(str(SAM_WEIGHTS))
        result = _sam.predict(image, bboxes=[[x1, y1, x2, y2]], verbose=False)[0]
        return (result.masks.data[0].cpu().numpy() > 0.5).astype(np.uint8)
    mask = np.zeros((h, w), np.uint8)
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(image, mask, (x1, y1, x2 - x1, y2 - y1), bg, fg, 5, cv2.GC_INIT_WITH_RECT)
    return np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)


def outline(mask, vertices=(6, 4)):
    """Largest blob -> convex hull -> simplified to about 6 (angled view) or 4 (front view) corners."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("Nothing found inside the box")
    hull = cv2.convexHull(max(contours, key=cv2.contourArea))
    perimeter = cv2.arcLength(hull, True)
    best = None
    for eps in np.linspace(0.005, 0.12, 60):
        poly = cv2.approxPolyDP(hull, eps * perimeter, True).reshape(-1, 2).astype(float)
        if len(poly) in vertices:
            best = poly
            if len(poly) == vertices[0]:
                break
        if len(poly) < min(vertices):
            break
    if best is None:
        best = cv2.boxPoints(cv2.minAreaRect(hull)).astype(float)
    return best, hull.reshape(-1, 2).astype(float)


def _line(p, q):
    """Line through two image points, in homogeneous form."""
    return np.cross([p[0], p[1], 1.0], [q[0], q[1], 1.0])


def _meet(l1, l2):
    """Where two homogeneous lines meet (a vanishing point may be at infinity: last value ~0)."""
    return np.cross(l1, l2)


def hidden_corner(poly, b, d, front, side):
    """Hidden back floor corner from perspective (vanishing points), or None if the outline is not a clean hexagon.

    Outline in turning order from the nearest floor corner b (step d): front floor corner, top above it,
    top back corner, top above the side corner, side floor corner. Edges that are parallel on the real shelf meet at
    one vanishing point in the picture:
      length direction: floor front edge (b->front) and top back edge (top-side -> top-back)
      depth direction:  floor side edge (b->side)   and top edge above the front corner (top-front -> top-back)
    The hidden corner is where the line from `front` along the depth meets the line from `side` along the length.
    """
    n = len(poly)
    if n != 6 or not np.allclose(poly[(b + 5 * d) % n], side):
        return None
    top_front, top_back, top_side = poly[(b + 2 * d) % n], poly[(b + 3 * d) % n], poly[(b + 4 * d) % n]
    vp_length = _meet(_line(poly[b], front), _line(top_side, top_back))
    vp_depth = _meet(_line(poly[b], side), _line(top_front, top_back))
    corner = _meet(np.cross([*front, 1.0], vp_depth), np.cross([*side, 1.0], vp_length))
    if abs(corner[2]) < 1e-9:
        return None
    corner = corner[:2] / corner[2]
    # Sanity: it must sit between the visible corners' spread, not shoot off to a far vanishing point.
    span = np.ptp(poly, axis=0).max()
    return corner if np.linalg.norm(corner - (front + side - poly[b])) < 0.5 * span else None


def footprint(poly):
    """Floor corners of a box-shaped shelf from its silhouette.

    Returns (front, corners): `front` is the front floor edge [left, right]; `corners` are the 4 floor corners
    [front-left, front-right, back-right, back-left], or None when only the front is visible.
    Image y grows downwards. Floor edges lean more than the shelf's almost-vertical upright edges, which is how they are told apart.
    """
    centre = poly.mean(axis=0)
    poly = poly[np.argsort(np.arctan2(poly[:, 1] - centre[1], poly[:, 0] - centre[0]))]  # turning order
    n = len(poly)
    b = int(np.argmax(poly[:, 1]))                       # lowest corner = nearest floor corner
    nb = [poly[(b - 1) % n], poly[(b + 1) % n]]
    # Upright shelf edges look almost vertical in the picture; floor edges (even ones going into depth) lean more.
    flat = lambda p: abs(p[0] - poly[b][0]) > 0.25 * abs(p[1] - poly[b][1])
    floor_neighbours = [p for p in nb if flat(p)]
    if len(floor_neighbours) == 2:
        # Front and one side visible: 3 floor corners; the hidden 4th completes the parallelogram.
        front, side = sorted(floor_neighbours, key=lambda p: abs(p[1] - poly[b][1]) / max(1e-6, abs(p[0] - poly[b][0])))
        d = 1 if np.allclose(poly[(b + 1) % n], front) else -1
        perspective = hidden_corner(poly, b, d, front, side)
        hidden = perspective if perspective is not None else front + side - poly[b]  # parallelogram fallback
        if front[0] < poly[b][0]:   # make the front edge run left -> right
            return [front.tolist(), poly[b].tolist()], [front.tolist(), poly[b].tolist(), side.tolist(), hidden.tolist()]
        return [poly[b].tolist(), front.tolist()], [poly[b].tolist(), front.tolist(), hidden.tolist(), side.tolist()]
    # Only the front is visible: the front floor edge is the lowest flat edge.
    other = floor_neighbours[0] if floor_neighbours else max(nb, key=lambda p: p[1])
    left, right = sorted([poly[b], other], key=lambda p: p[0])
    return [left.tolist(), right.tolist()], None


def analyse(image, box, method):
    mask = segment(image, box, method)
    poly, hull = outline(mask)
    front, corners = footprint(poly)
    return {"method": method, "outline": poly.tolist(), "front": front, "corners": corners, "maskPixels": int(mask.sum())}


def decode(data_url):
    raw = base64.b64decode(data_url.split(",", 1)[-1])
    if len(raw) > 6_000_000:
        raise ValueError("Image too large")
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Not an image")
    return image


class Handler(BaseHTTPRequestHandler):
    def send_file(self, path, kind):
        """Videos must be seekable: answer "Range: bytes=a-b" with 206 Partial Content."""
        size = path.stat().st_size
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        start, end = 0, size - 1
        if m and (m.group(1) or m.group(2)):
            if m.group(1): start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else min(size - 1, start + 8 * 2**20 - 1)  # open-ended: 8 MB at a time
            else: start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end: self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
        with open(path, "rb") as f:
            f.seek(start); data = f.read(end - start + 1)
        self.send_response(206 if m and (m.group(1) or m.group(2)) else 200)
        self.send_header("Content-Type", kind); self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Length", str(len(data)))
        if m and (m.group(1) or m.group(2)): self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass  # the browser often drops a range request it no longer needs

    def send(self, status, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")  # the page and its scripts change often: never run an old copy
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.path = self.path.split("?", 1)[0]  # ignore cache-busting query strings
        if self.path in ("/", "/index.html"):
            return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if self.path == "/cam":  # the same page in the redesign look (cam/theme.css + cam/shell.js); "/" stays as it was
            page = (HERE / "index.html").read_text(encoding="utf-8")
            page = page.replace("</head>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">\n<link rel="stylesheet" href="/cam/theme.css">\n</head>', 1)
            page = page.replace("</body>", '<script src="/cam/shell.js"></script>\n</body>', 1)
            return self.send(200, page.encode("utf-8"), "text/html; charset=utf-8")
        if self.path in ("/cam/theme.css", "/cam/shell.js"):
            return self.send(200, (HERE / self.path[1:]).read_bytes(), "text/css; charset=utf-8" if self.path.endswith(".css") else "text/javascript; charset=utf-8")
        if self.path == "/v1":  # the earlier one-reference-shelf page, kept for comparison
            return self.send(200, (HERE / "index-v1.html").read_bytes(), "text/html; charset=utf-8")
        if self.path == "/geometry.js":
            return self.send(200, (HERE / "geometry.js").read_bytes(), "text/javascript; charset=utf-8")
        if self.path in ("/demo.webm", "/walk.webm"):  # Repo videos: cartoon shelf demo, and a real recorded clip with people.
            demo = HERE.parent / ("NTT_Prototype/web/public/demos/customer-walk.webm" if self.path == "/demo.webm" else "NTT_Prototype/web/public/vision/customer-detection.webm")
            return self.send_file(demo, "video/webm") if demo.is_file() else self.send(404, {"error": "No demo video"})
        if re.fullmatch(r"/epfl/[a-z0-9_]+\.(webm|json)", self.path):  # EPFL lab sequence (research use) and its test cases
            clip = HERE / "epfl_lab" / self.path.rsplit("/", 1)[1]
            kind = "video/webm" if clip.suffix == ".webm" else "application/json"
            return self.send_file(clip, kind) if clip.is_file() else self.send(404, {"error": "Run the EPFL download / epfl_cases.py first"})
        if re.fullmatch(r"/devlog/[A-Za-z0-9_-]{1,80}", self.path):  # read back a saved test recording (not truth files)
            f = HERE / "tests" / "logs" / "dev" / (self.path.rsplit("/", 1)[1] + ".json")
            return self.send(200, f.read_bytes(), "application/json") if f.is_file() else self.send(404, {"error": "No such log"})
        if self.path == "/sets.json":  # video sets in tests/videos (names + camera files only; truth files are never served)
            return self.send(200, {"sets": video_sets()})
        if re.fullmatch(r"/sets/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.webm", self.path):
            _, _, sid, name = self.path.split("/")
            clip = HERE / "tests" / "videos" / sid / name
            return self.send_file(clip, "video/webm") if clip.is_file() else self.send(404, {"error": "No such video"})
        if self.path in ("/sample.png", "/sample_truth.json") and (HERE / self.path[1:]).is_file():
            return self.send(200, (HERE / self.path[1:]).read_bytes(), "image/png" if self.path.endswith(".png") else "application/json")
        if self.path == "/status":
            return self.send(200, {"sam": SAM_WEIGHTS.is_file(), "yolo": YOLO_WEIGHTS.is_file(), "openvino": YOLO_OPENVINO.is_dir()})
        self.send(404, {"error": "Not found"})

    def do_POST(self):
        m = re.fullmatch(r"/devlog/([A-Za-z0-9_-]{1,80})", self.path)
        if m:  # test runs save what they read from the page (results, usage log) to tests/logs/dev/<name>.json
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length < 20_000_000:
                return self.send(400, {"error": "Bad request size"})
            out = HERE / "tests" / "logs" / "dev"; out.mkdir(parents=True, exist_ok=True)
            (out / f"{m.group(1)}.json").write_bytes(self.rfile.read(length))
            return self.send(200, {"saved": f"tests/logs/dev/{m.group(1)}.json"})
        if self.path not in ("/segment", "/people"):
            return self.send(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length < 9_000_000:
                raise ValueError("Bad request size")
            body = json.loads(self.rfile.read(length))
            if self.path == "/people":
                vt = body.get("t"); vt = float(vt) if isinstance(vt, (int, float)) else None
                return self.send(200, {"people": people(decode(body["image"]), bool(body.get("track")), bool(body.get("reset")), bool(body.get("tuned")), bool(body.get("fast", True)), str(body.get("camera", "1")), vt)})
            self.send(200, analyse(decode(body["image"]), body["box"], body.get("method", "sam")))
        except (ValueError, KeyError, TypeError) as error:
            self.send(400, {"error": str(error)})

    def log_message(self, *args):
        pass


def selftest():
    """Synthetic shelves: an angled box (hexagon) and a front view (rectangle), checked with GrabCut."""
    image = np.full((360, 640, 3), (90, 110, 95), np.uint8)
    noise = np.random.default_rng(1).integers(0, 18, image.shape, dtype=np.uint8)
    image = cv2.add(image, noise)
    floor = np.array([[200, 260], [330, 290], [420, 240], [290, 215]])  # front-left, front, right, back (floor)
    top = floor - [0, 90]
    for face in ([floor[0], floor[1], top[1], top[0]], [floor[1], floor[2], top[2], top[1]], list(top)):
        cv2.fillPoly(image, [np.array(face, np.int32)], (40, 60, 160))
    cv2.polylines(image, [np.array(top, np.int32)], True, (60, 90, 200), 2)
    found = analyse(image, [180, 110, 440, 305], "grabcut")
    assert found["corners"], f"angled box: expected 4 floor corners, got {found}"
    hits = sum(min(np.hypot(px - x, py - y) for px, py in found["corners"]) < 12 for x, y in floor[:3].tolist())
    assert hits == 3, f"angled box: expected the 3 visible floor corners, got {found['corners']}"
    assert min(np.hypot(px - floor[3][0], py - floor[3][1]) for px, py in found["corners"]) < 25, f"hidden corner off: {found['corners']}"
    assert found["front"][0][0] < found["front"][1][0], "front edge must run left to right"
    front = np.full((360, 640, 3), (90, 110, 95), np.uint8)
    cv2.rectangle(front, (100, 120), (260, 200), (40, 60, 160), -1)
    found = analyse(front, [90, 110, 270, 210], "grabcut")
    assert found["corners"] is None and all(abs(p[1] - 200) < 6 for p in found["front"]), found
    print("selftest ok")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
    else:
        if REID_XML.is_file():
            import openvino as ov
            _reid["model"] = ov.Core().compile_model(str(REID_XML), "CPU")
        if YOLO_WEIGHTS.is_file():  # load 4 camera models in the background while the page opens
            threading.Thread(target=lambda: [_pool.append(yolo_model(True)) for _ in range(4)], daemon=True).start()
        print(f"Shelf calibration prototype: http://127.0.0.1:{args.port}", flush=True)
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
