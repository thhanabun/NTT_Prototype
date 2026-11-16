"""verify videos of scenarios (first/last frame readable, people counted by YOLO11n about once per second) -> truth.json['verification']
python verify.py B1-01 ..."""
import sys, json
from pathlib import Path
import cv2, numpy as np
from ultralytics import YOLO
T = Path(__file__).resolve().parents[1]; m = YOLO(str(T.parents[1] / "NTT_Prototype/data/vision/yolo11n.pt"))
for sid in sys.argv[1:]:
    d = T / "videos" / sid; tr = json.loads((d / "truth.json").read_text()); ver = []
    for cam in tr["cameras"]:
        cap = cv2.VideoCapture(str(d / cam["file"])); n = int(cap.get(7)); fps = cap.get(5) or tr["fps"]; ok0, f0 = cap.read()
        cap.set(1, max(0, n - 2)); okl, fl = cap.read(); step = max(1, int(round(fps)))
        cap.set(1, 0); cnt = []
        for i in range(0, n, step):
            ok, f = cap.read()
            for _ in range(step - 1): cap.grab()
            if not ok: break
            r = m.predict(f, classes=[0], conf=0.3, imgsz=640, verbose=False)[0]; cnt.append(sum(1 for b in r.boxes.xyxy.tolist() if b[3] - b[1] > 0.12 * f.shape[0]))
        c = np.array(cnt); ev = int(sum(1 for a, b in zip(c, c[1:]) if a == 0 and b > 0 and True))
        ver.append({"file": cam["file"], "frames": n, "fps": round(fps, 2), "duration_s": round(n / fps, 1), "size": [int(cap.get(3)), int(cap.get(4))], "first_frame_ok": bool(ok0), "last_frame_ok": bool(okl),
                    "people_per_sample_mean": round(float(c.mean()), 2), "people_per_sample_max": int(c.max()), "frac_samples_with_2plus": round(float((c >= 2).mean()), 2), "empty_to_occupied_events": ev,
                    "bytes": (d / cam["file"]).stat().st_size})
    tr["verification"] = ver; (d / "truth.json").write_text(json.dumps(tr, indent=1))
    print(sid, [(v["frames"], v["frac_samples_with_2plus"], v["people_per_sample_mean"], v["first_frame_ok"] and v["last_frame_ok"]) for v in ver], flush=True)
