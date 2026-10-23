"""Render the synthetic Admin clip. Requires the existing .venv-vision (OpenCV + NumPy)."""
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
demo = json.loads((ROOT / "web/src/lib/customer-tracking-demo.json").read_text())
target = ROOT / "web/public/demos/customer-walk.webm"
target.parent.mkdir(parents=True, exist_ok=True)
width, height, fps = demo["width"], demo["height"], 12
writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"VP80"), fps, (width, height))
if not writer.isOpened():
    raise RuntimeError("OpenCV cannot encode VP8/WebM on this machine")


def position(points, time):
    for before, after in zip(points, points[1:]):
        if time <= after[0]:
            ratio = max(0, min(1, (time - before[0]) / (after[0] - before[0])))
            return before[1] + (after[1] - before[1]) * ratio, before[2] + (after[2] - before[2]) * ratio
    return points[-1][1:]


try:
    for frame_index in range(demo["duration"] * fps):
        time = frame_index / fps
        frame = np.full((height, width, 3), (35, 44, 42), dtype=np.uint8)
        cv2.rectangle(frame, (24, 46), (936, 524), (58, 69, 65), -1)
        for x in range(32, width, 64):
            cv2.line(frame, (x, 46), (x, 524), (64, 76, 71), 1)
        for y in range(60, height, 56):
            cv2.line(frame, (24, y), (936, y), (64, 76, 71), 1)
        for index, center in enumerate([0.19, 0.50, 0.81]):
            left = int(32 + (center - 0.105) * 896)
            right = int(32 + (center + 0.105) * 896)
            cv2.rectangle(frame, (left + 8, 142), (right + 8, 280), (37, 47, 43), -1)
            cv2.rectangle(frame, (left, 132), (right, 266), (92, 109, 97), -1)
            for row in range(3):
                for col in range(7):
                    color = (110, 153, 170) if col % 2 else (152, 149, 98)
                    cv2.rectangle(frame, (left + 10 + col * 24, 150 + row * 34), (left + 22 + col * 24, 172 + row * 34), color, -1)
            cv2.putText(frame, f"SHELF {index + 1}", (left + 32, 124), cv2.FONT_HERSHEY_SIMPLEX, .48, (204, 221, 210), 1, cv2.LINE_AA)
        for track in sorted(demo["tracks"], key=lambda item: position(item["points"], time)[1]):
            x, y = position(track["points"], time)
            foot = (int(32 + x * 896), int(60 + y * 450))
            size = 50 + 55 * y
            color = tuple(int(track["color"][i:i + 2], 16) for i in (5, 3, 1))
            sway = int(np.sin(time * 7) * size * .035)
            cv2.ellipse(frame, (foot[0], foot[1] - 1), (int(size * .27), 6), 0, 0, 360, (34, 43, 39), -1)
            for side in [-1, 1]:
                cv2.line(frame, (foot[0] + side * 8, foot[1] - int(size * .39)), (foot[0] + side * 10 + side * sway, foot[1] - 4), (49, 57, 61), 9, cv2.LINE_AA)
            cv2.ellipse(frame, (foot[0], foot[1] - int(size * .57)), (int(size * .20), int(size * .27)), 0, 0, 360, color, -1, cv2.LINE_AA)
            cv2.circle(frame, (foot[0], foot[1] - int(size * .87)), int(size * .12), (178, 198, 213), -1, cv2.LINE_AA)
        cv2.putText(frame, "FAST / CAM 01 / SYNTHETIC", (30, 30), cv2.FONT_HERSHEY_SIMPLEX, .5, (198, 215, 205), 1, cv2.LINE_AA)
        writer.write(frame)
        if frame_index == 0:
            cv2.imwrite(str(target.with_suffix(".jpg")), frame)
finally:
    writer.release()
print(f"Generated {target.name}: {target.stat().st_size:,} bytes")
