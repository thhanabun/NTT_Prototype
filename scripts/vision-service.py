"""Local read-only YOLO11n inference over hash-pinned mock frames; no URL/path input."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent
ASSETS = json.loads((ROOT / "infra/vision/assets.json").read_text())
DATA = ROOT / "data/vision"
LIMITATION = "Generic COCO object detection on a MOCK still image; no SKU, basket ownership, PICK/PUT_BACK or temporal proof."


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


def serve(port):
    vision = Vision()

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
                               "weightsSha256": ASSETS["model"]["sha256"], "frames": list(ASSETS["frames"])})

        def do_POST(self):
            if self.path != "/infer":
                return self.respond(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 1024:
                    raise ValueError("Invalid request size")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict) or set(body) != {"frameId"}:
                    raise ValueError("Only frameId is accepted")
                result = vision.predict(body["frameId"])
            except (ValueError, TypeError, KeyError) as error:
                return self.respond(400, {"error": str(error)})
            except Exception:
                return self.respond(503, {"error": "Vision inference unavailable"})
            self.respond(200, result)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"YOLO11n ready at http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    os.environ.setdefault("YOLO_CONFIG_DIR", str(DATA / "settings"))
    (Path(os.environ["YOLO_CONFIG_DIR"]) / "Ultralytics").mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_OFFLINE", "true")
    os.environ.setdefault("YOLO_AUTOINSTALL", "false")
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    serve(parser.parse_args().port)
