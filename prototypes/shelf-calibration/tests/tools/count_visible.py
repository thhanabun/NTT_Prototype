"""visible_count_per_s for scenarios without GT: YOLO11n person boxes (conf .3, imgsz 960) per camera at 1 Hz, boxes cut by the frame border dropped (aspect check),
foot points projected to the floor with the truth homography, detections of different cameras closer than 0.5 m merged -> n unique people.
python count_visible.py write B1-02 ...   |   python count_visible.py check B1-01 (compare with gt_positions)"""
import sys, json
from pathlib import Path
import cv2, numpy as np
from ultralytics import YOLO
T = Path(__file__).resolve().parents[1]; THR = 1.0
m = YOLO(str(T.parents[1] / "NTT_Prototype/data/vision/yolo11n.pt"))
def count(sid, thr=THR):
    d = T / "videos" / sid; tr = json.loads((d / "truth.json").read_text()); caps = []; out = []
    for c in tr["cameras"]: caps.append((cv2.VideoCapture(str(d / c["file"])), np.array(c["H_img_to_floor_m"]), c["size"]))
    fps = tr["fps"]; dur = int(tr["duration_s"]) - 1
    for t in range(dur + 1):
        pts = []; per = []
        for cap, H, (W, Hh) in caps:
            cap.set(1, int(round(t * fps))); ok, f = cap.read()
            if not ok: per.append(0); continue
            r = m.predict(f, classes=[0], conf=0.3, imgsz=960, verbose=False)[0]; n = 0
            for (x1, y1, x2, y2), cf in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()):
                w, h = x2 - x1, y2 - y1
                if h < 0.12 * Hh or h / max(w, 1) < 1.1: continue          # tiny or cut sideways / mostly hidden
                if y1 <= 2 and h / max(w, 1) < 1.8: continue                # head cut off
                p = H @ [(x1 + x2) / 2, y2, 1.0]; pts.append((cf, p[:2] / p[2])); n += 1
            per.append(n)
        pts.sort(key=lambda a: -a[0]); kept = []
        for _, p in pts:
            if all(np.linalg.norm(p - q) > thr for q in kept): kept.append(p)
        out.append({"t": t, "n": len(kept), "per_camera": per, "pts": [(c, p.tolist()) for c, p in pts]})
    return out
if __name__ == "__main__":
    mode = sys.argv[1]
    for sid in sys.argv[2:]:
        res = count(sid)
        if mode == "check":
            tr = json.loads((T / "videos" / sid / "truth.json").read_text()); g = {round(f["t"]): len(f["people"]) for f in tr["gt_positions"]["frames"]}
            print(sid, "t:(det,gt)", [(r["t"], r["n"], g.get(r["t"])) for r in res[::4]])
        else:
            p = T / "videos" / sid / "truth.json"; tr = json.loads(p.read_text())
            tr["visible_count_per_s"] = [{"t": r["t"], "n": r["n"], "n_min": max(r["per_camera"])} for r in res]
            tr["visible_count_note"] = "auto: YOLO11n person boxes (>=~half visible, border-cut boxes dropped) per camera at 1 Hz, merged across cameras on the floor (1.5 m; tuned on B1-01/B1-09/B3-16 vs EPFL GT: mean err ~0, MAE ~1 person); n_min = most people seen by any single camera; no dataset GT for this scenario. Lower bound in crowds."
            tr["visible_count_per_camera"] = [{"t": r["t"], "n": r["per_camera"]} for r in res]
            p.write_text(json.dumps(tr, indent=1)); print(sid, "mean", round(float(np.mean([r["n"] for r in res])), 2), "max", max(r["n"] for r in res))
