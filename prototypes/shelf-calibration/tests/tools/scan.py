"""count people (YOLO11n) every STEP frames of each source video -> downloads/scan/<video>.json"""
import sys, json, cv2
from pathlib import Path
from ultralytics import YOLO
m = YOLO(str(Path(__file__).resolve().parents[3] / "NTT_Prototype/data/vision/yolo11n.pt"))
STEP = 15; out = Path(__file__).resolve().parents[1] / "downloads/scan"; out.mkdir(exist_ok=True)
for v in sys.argv[1:]:
    o = out / (Path(v).stem + ".json")
    if o.exists(): continue
    cap = cv2.VideoCapture(v); n = int(cap.get(7)); res = {}
    for i in range(0, n, STEP):
        ok, f = cap.read()
        for _ in range(STEP - 1): cap.grab()
        if not ok: break
        r = m.predict(f, classes=[0], conf=0.3, imgsz=640, verbose=False)[0]
        res[i] = [[round(float(x)) for x in b] for b in r.boxes.xyxy.tolist()]
    o.write_text(json.dumps(res)); print(v, len(res), flush=True)
