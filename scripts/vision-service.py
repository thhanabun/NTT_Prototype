"""Local YOLO11n evidence and bounded in-memory camera-frame inference."""
import argparse
from collections import OrderedDict
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent
ASSETS = json.loads((ROOT / "infra/vision/assets.json").read_text())
DATA = ROOT / "data/vision"
LIMITATION = "Generic COCO object detection on a MOCK still image; no SKU, basket ownership, PICK/PUT_BACK or temporal proof."


class VisionHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let an older server keep answering the same port.
    allow_reuse_address = os.name != "nt"
    allow_reuse_port = False

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def verified_asset(asset):
    path = (DATA / asset["file"]).resolve()
    if path.parent != DATA.resolve() or not path.is_file() or path.stat().st_size > 10_000_000:
        raise ValueError("Invalid or missing vision asset; run npm run model:vision first")
    if hashlib.sha256(path.read_bytes()).hexdigest() != asset["sha256"]:
        raise ValueError("Vision asset hash mismatch")
    return path


class Vision:
    def __init__(self):
        # Import lazily so contract/path checks do not require installing the runtime.
        from ultralytics import YOLO
        import torch
        torch.set_num_threads(2)
        self.lock = threading.Lock()
        self.streams = OrderedDict()
        self.model = YOLO(str(verified_asset(ASSETS["model"])))
        self.predict(next(iter(ASSETS["frames"])))  # Preload before advertising readiness.

    def predict(self, frame_id):
        if not isinstance(frame_id, str) or frame_id not in ASSETS["frames"]:
            raise ValueError("Unknown registered frameId")
        asset = ASSETS["frames"][frame_id]
        path = verified_asset(asset)
        from PIL import Image
        with Image.open(path) as image:
            if image.width * image.height > 16_000_000:
                raise ValueError("Frame dimensions exceed limit")
            with self.lock:
                started = time.perf_counter()
                result = self.model.predict(image.convert("RGB"), device="cpu", imgsz=640,
                                            conf=0.25, max_det=20, verbose=False, save=False)[0]
                detections = [{"classId": int(box.cls.item()), "label": result.names[int(box.cls.item())],
                               "confidence": round(float(box.conf.item()), 5),
                               "box": [round(float(value), 2) for value in box.xyxy[0].tolist()]}
                              for box in result.boxes]
        return {"status": "AVAILABLE", "model": "yolo11n", "weightsSha256": ASSETS["model"]["sha256"],
                "frameId": frame_id, "source": asset["source"], "frameSha256": asset["sha256"],
                "imageSize": {"width": image.width, "height": image.height},
                "inferenceMs": round((time.perf_counter() - started) * 1000, 2),
                "detections": detections, "limitation": LIMITATION}

    def live(self, payload, session):
        from PIL import Image, UnidentifiedImageError
        import numpy as np
        from types import SimpleNamespace
        from ultralytics.trackers.byte_tracker import BYTETracker

        class CameraTracker(BYTETracker):
            @staticmethod
            def reset_id():
                # Other camera sessions may still own IDs from the shared counter.
                pass

        if not re.fullmatch(r"[a-f0-9-]{36}", session):
            raise ValueError("Invalid camera session")
        try:
            with Image.open(io.BytesIO(payload)) as image:
                if image.format != "JPEG" or image.width > 1280 or image.height > 720 or min(image.size) < 32:
                    raise ValueError("Expected JPEG up to 1280x720")
                pixels = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
        except (UnidentifiedImageError, OSError) as error:
            raise ValueError("Invalid JPEG") from error
        with self.lock:
            started = time.perf_counter()
            for key in list(self.streams):
                if started - self.streams[key][1] > 60:
                    del self.streams[key]
            if session not in self.streams:
                if len(self.streams) >= 4:
                    raise ValueError("Camera capacity reached; stop another camera or wait one minute")
                options = SimpleNamespace(track_high_thresh=.4, track_low_thresh=.1, new_track_thresh=.5,
                                          track_buffer=10, match_thresh=.8, fuse_score=True)
                self.streams[session] = [CameraTracker(options, frame_rate=30), started]
            tracker = self.streams[session][0]
            self.streams[session][1] = started
            result = self.model.predict(pixels, device="cpu", imgsz=640, classes=[0], conf=.25,
                                        max_det=12, verbose=False, save=False)[0]
            tracks = tracker.update(result.boxes.cpu().numpy(), pixels)
            detections = [{"trackId": int(row[4]), "confidence": round(float(row[5]), 4),
                           "box": [round(float(value), 2) for value in row[:4]]} for row in tracks]
        return {"model": "yolo11n", "tracker": "ByteTrack", "source": "LIVE_CAMERA",
                "imageSize": {"width": pixels.shape[1], "height": pixels.shape[0]}, "detections": detections,
                "inferenceMs": round((time.perf_counter() - started) * 1000, 2)}


def serve(port):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/health":
                return self.respond(404, {"error": "Not found"})
            self.respond(200, {"model": "yolo11n", "device": "cpu", "ready": True,
                               "weightsSha256": ASSETS["model"]["sha256"], "frames": list(ASSETS["frames"]),
                               "capabilities": ["registered_frames", "live_camera"]})

        def do_POST(self):
            if self.path not in ("/infer", "/live"):
                return self.respond(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > (512_000 if self.path == "/live" else 1024):
                    raise ValueError("Invalid request size")
                if self.path == "/live":
                    if self.headers.get("Content-Type", "").split(";")[0] != "image/jpeg":
                        raise ValueError("Expected image/jpeg")
                    return self.respond(200, vision.live(self.rfile.read(length), self.headers.get("X-Camera-Session", "")))
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict) or set(body) != {"frameId"}:
                    raise ValueError("Only frameId is accepted")
                result = vision.predict(body["frameId"])
            except (ValueError, TypeError, KeyError) as error:
                return self.respond(400, {"error": str(error)})
            except Exception:
                return self.respond(503, {"error": "Vision inference unavailable"})
            self.respond(200, result)

    server = VisionHTTPServer(("127.0.0.1", port), Handler)
    try:
        vision = Vision()
        print(f"YOLO11n ready at http://127.0.0.1:{port} (registered_frames, live_camera)", flush=True)
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    os.environ.setdefault("YOLO_CONFIG_DIR", str(DATA / "settings"))
    (Path(os.environ["YOLO_CONFIG_DIR"]) / "Ultralytics").mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_OFFLINE", "true")
    os.environ.setdefault("YOLO_AUTOINSTALL", "false")
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    serve(parser.parse_args().port)
