"""Run real YOLO11n/ByteTrack on a local clip, then render the calibrated Admin replay."""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("YOLO_CONFIG_DIR", str(ROOT / "data/vision/settings"))
os.environ.setdefault("YOLO_OFFLINE", "true")
os.environ.setdefault("YOLO_AUTOINSTALL", "false")

import cv2
import numpy as np


def detect(source, cache, fps):
    if fps <= 0:
        raise ValueError("Sample FPS must be positive")
    print("Loading CPU vision runtime...", flush=True)
    import torch
    from ultralytics import YOLO

    torch.set_num_threads(2)
    weights = ROOT / "data/vision/yolo11n.pt"
    expected = json.loads((ROOT / "infra/vision/assets.json").read_text())["model"]["sha256"]
    if hashlib.sha256(weights.read_bytes()).hexdigest() != expected:
        raise ValueError("YOLO weights do not match the pinned model")
    model = YOLO(str(weights))
    print("YOLO11n weights loaded; starting ByteTrack inference", flush=True)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError("Cannot decode input video")
    source_fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if source_fps <= 0 or count <= 0:
        cap.release()
        raise ValueError("Input video has no valid frame rate or frames")
    width, height = 1280, 720
    frames = []
    orb = cv2.ORB_create(nfeatures=2200)
    reference_points = reference_descriptors = None
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    next_sample = 0
    try:
        for index in range(count):
            ok = cap.grab()
            if not ok:
                break
            time = index / source_fps
            if time + 1e-6 < next_sample:
                continue
            ok, original = cap.retrieve()
            if not ok:
                continue
            next_sample += 1 / fps
            frame = cv2.resize(original, (width, height))
            result = model.track(frame, persist=True, tracker="bytetrack.yaml", classes=[0], conf=.25,
                                 imgsz=640, max_det=8, device="cpu", verbose=False, save=False)[0]
            boxes = []
            if result.boxes.id is not None:
                for box, identity, confidence in zip(result.boxes.xyxy.tolist(), result.boxes.id.tolist(), result.boxes.conf.tolist()):
                    boxes.append({"trackId": int(identity), "confidence": round(confidence, 4), "box": [round(x, 2) for x in box]})
            mask = np.full((height, width), 255, dtype=np.uint8)
            # Static scene features compensate the handheld camera, excluding detected people.
            for box in boxes:
                x1, y1, x2, y2 = map(int, box["box"])
                cv2.rectangle(mask, (max(0, x1 - 15), max(0, y1 - 15)), (min(width, x2 + 15), min(height, y2 + 15)), 0, -1)
            points, descriptors = orb.detectAndCompute(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), mask)
            transform = np.eye(3)
            inliers = 0
            residual = None
            if reference_descriptors is None:
                reference_points, reference_descriptors = points, descriptors
            elif descriptors is not None:
                matches = matcher.knnMatch(descriptors, reference_descriptors, k=2)
                good = [pair[0] for pair in matches if len(pair) == 2 and pair[0].distance < .72 * pair[1].distance]
                if len(good) >= 20:
                    current = np.float32([points[m.queryIdx].pt for m in good])
                    reference = np.float32([reference_points[m.trainIdx].pt for m in good])
                    estimated, keep = cv2.findHomography(current, reference, cv2.RANSAC, 3)
                    if estimated is not None and keep is not None and int(keep.sum()) >= 20:
                        transform = estimated / estimated[2, 2]
                        inliers = int(keep.sum())
                        projected = cv2.perspectiveTransform(current.reshape(-1, 1, 2), transform).reshape(-1, 2)
                        residual = round(float(np.median(np.linalg.norm(projected - reference, axis=1)[keep.ravel() > 0])), 3)
            frames.append({"time": round(time, 4), "detections": boxes, "cameraToReference": transform.round(8).tolist(),
                           "alignmentInliers": inliers, "alignmentResidualPx": residual})
            if len(frames) % 30 == 0:
                print(f"YOLO {time:.1f}/{count/source_fps:.1f}s ({len(frames)} samples)", flush=True)
    finally:
        cap.release()
    data = {"source": source.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "model": "yolo11n", "weightsSha256": expected, "tracker": "ByteTrack", "sampleFps": fps,
            "width": width, "height": height, "duration": count / source_fps, "sourceFps": source_fps, "frames": frames}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    identities = {}
    for sample in frames:
        for box in sample["detections"]:
            item = identities.setdefault(box["trackId"], {"first": sample["time"], "last": 0, "samples": 0})
            item["last"], item["samples"] = sample["time"], item["samples"] + 1
    print(json.dumps({"cache": str(cache), "tracks": identities}, indent=2), flush=True)


def project(points, transform):
    return cv2.perspectiveTransform(np.float32(points).reshape(-1, 1, 2), transform).reshape(-1, 2)


def render(source, cache, calibration_path):
    data = json.loads(cache.read_text(encoding="utf-8"))
    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    if hashlib.sha256(source.read_bytes()).hexdigest() != data["sourceSha256"]:
        raise ValueError("Detection cache belongs to a different source clip")
    assignments = {raw_id: item for item in calibration["basketAssignments"] for raw_id in item["trackIds"]}
    if {item["basketId"] for item in assignments.values()} != {"A", "B"}:
        raise ValueError("Review ByteTrack IDs and assign Basket A/B before rendering")
    floor = cv2.getPerspectiveTransform(np.float32(calibration["floorImagePoints"]), np.float32(calibration["floorMapPoints"]))
    shelves = [{"id": shelf["id"], "label": shelf["label"],
                "polygon": project(shelf["floorImagePolygon"], floor).round(5).tolist()} for shelf in calibration["shelves"]]
    frames = []
    for index, sample in enumerate(data["frames"]):
        alignment_valid = index == 0 or sample["alignmentInliers"] >= 20
        transform = np.array(sample["cameraToReference"])
        detections = []
        for detection in sample["detections"]:
            assignment = assignments.get(detection["trackId"])
            if assignment is None:
                continue
            x1, y1, x2, y2 = detection["box"]
            foot = ((x1 + x2) / 2, y2)
            point = project([foot], floor @ transform)[0]
            in_map = alignment_valid and 0 <= point[0] <= 1 and 0 <= point[1] <= 1
            detections.append({"basketId": assignment["basketId"], "trackId": detection["trackId"],
                               "confidence": detection["confidence"], "box": detection["box"],
                               "mapPoint": {"x": round(float(point[0]), 5), "y": round(float(point[1]), 5)} if in_map else None})
        frames.append({"time": sample["time"], "detections": detections, "alignmentValid": alignment_valid})
    public = ROOT / "web/public/vision"
    public.mkdir(parents=True, exist_ok=True)
    (ROOT / "tmp/customer-clip").mkdir(parents=True, exist_ok=True)
    target = public / "customer-detection.webm"
    output_fps = 15
    writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"VP80"), output_fps, (data["width"], data["height"]))
    if not writer.isOpened():
        raise ValueError("Cannot encode VP8 video")
    cap = cv2.VideoCapture(str(source))
    sample_index = 0
    source_index = -1
    last_frame = None
    try:
        output_count = int(data["duration"] * output_fps)
        for index in range(output_count):
            time = index / output_fps
            needed_source = min(round(time * data["sourceFps"]), int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) - 1)
            while source_index < needed_source:
                if not cap.grab():
                    break
                source_index += 1
            ok, original = cap.retrieve()
            if ok:
                last_frame = cv2.resize(original, (data["width"], data["height"]))
            if last_frame is None:
                raise ValueError("Input video decoding failed")
            frame = last_frame.copy()
            while sample_index + 1 < len(frames) and frames[sample_index + 1]["time"] <= time:
                sample_index += 1
            sample = frames[sample_index]
            inverse = np.linalg.inv(np.array(data["frames"][sample_index]["cameraToReference"]))
            for shelf in calibration["shelves"]:
                point = project([shelf["labelImagePoint"]], inverse)[0].astype(int)
                x, y = point.tolist()
                cv2.rectangle(frame, (x - 44, y - 19), (x + 44, y + 5), (28, 40, 37), -1)
                cv2.putText(frame, shelf["label"], (x - 35, y - 2), cv2.FONT_HERSHEY_SIMPLEX, .55, (231, 240, 233), 1, cv2.LINE_AA)
            for detection in sample["detections"]:
                assignment = next(item for item in calibration["basketAssignments"] if item["basketId"] == detection["basketId"])
                color = tuple(int(assignment["color"][i:i + 2], 16) for i in (5, 3, 1))
                x1, y1, x2, y2 = map(round, detection["box"])
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
                label = f"Customer | Basket {detection['basketId']}  {detection['confidence']:.0%}"
                label_x = max(0, min(x1, data["width"] - 260))
                label_y = max(25, y1)
                cv2.rectangle(frame, (label_x, label_y - 25), (label_x + 260, label_y), color, -1)
                cv2.putText(frame, label, (label_x + 6, label_y - 8), cv2.FONT_HERSHEY_SIMPLEX, .5, (25, 35, 30), 1, cv2.LINE_AA)
                cv2.circle(frame, (int((x1 + x2) / 2), y2), 4, color, -1)
            writer.write(frame)
            if index == 0:
                cv2.imwrite(str(public / "customer-detection.jpg"), frame)
            if index % (output_fps * 10) == 0:
                cv2.imwrite(str(ROOT / f"tmp/customer-clip/annotated-{int(time):02d}.jpg"), frame)
                print(f"Rendering annotated video {time:.0f}/{data['duration']:.1f}s", flush=True)
    finally:
        writer.release()
        cap.release()
    # Browser replay uses an explicit bitrate; OpenCV's default VP8 output is unnecessarily large.
    import imageio_ffmpeg
    compressed = public / "customer-detection-compressed.webm"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
                    "-i", str(target), "-an", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0",
                    "-cpu-used", "4", "-row-mt", "1", "-threads", "2", "-pix_fmt", "yuv420p",
                    str(compressed)], check=True)
    compressed.replace(target)
    duration = output_count / output_fps
    metadata = {"source": data["source"], "sourceSha256": data["sourceSha256"], "model": data["model"],
                "weightsSha256": data["weightsSha256"], "tracker": data["tracker"], "sampleFps": data["sampleFps"],
                "duration": duration, "width": data["width"], "height": data["height"], "fps": output_fps,
                "videoUrl": "/vision/customer-detection.webm", "posterUrl": "/vision/customer-detection.jpg",
                "baskets": [{"basketId": item["basketId"], "color": item["color"], "order": item["order"]} for item in calibration["basketAssignments"]],
                "reviewedTrackAssignments": calibration["basketAssignments"],
                "excludedTracks": calibration.get("excludedTracks", []),
                "shelves": shelves, "calibration": {"method": calibration["method"], "metricScale": False,
                    "floorImagePoints": calibration["floorImagePoints"], "floorMapPoints": calibration["floorMapPoints"],
                    "homography": floor.round(9).tolist(), "identitySource": "USER_ASSIGNED",
                    "alignedSamples": sum(frame["alignmentValid"] for frame in frames), "limitations": calibration["limitations"]},
                "frames": frames}
    destination = ROOT / "web/src/lib/customer-tracking-recording.json"
    destination.write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"videoBytes": target.stat().st_size, "samples": len(frames), "metadataBytes": destination.stat().st_size,
                      "alignedSamples": metadata["calibration"]["alignedSamples"]}, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--cache", type=Path, default=ROOT / "data/vision/customer-clip-detections.json")
    parser.add_argument("--fps", type=float, default=10)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--calibration", type=Path, default=ROOT / "infra/vision/customer-clip-calibration.json")
    args = parser.parse_args()
    if args.render:
        render(args.source, args.cache, args.calibration)
    else:
        detect(args.source, args.cache, args.fps)
