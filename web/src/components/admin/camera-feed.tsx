"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteCameraMapping } from "@/lib/api/client";
import type { StoreMap } from "@/lib/api/types";
import { invert, project, type Point } from "@/lib/camera-calibration";
import { CameraMapSetup } from "./camera-map-setup";
import { corners } from "./store-map-view";
import styles from "./customer-detection.module.css";

export type CameraSource = { kind: "device"; deviceId: string; label: string } | { kind: "file"; file: File };
export type TrackSample = { trackId: number; confidence: number; box: number[]; floor: Point | null; occluded: boolean };
export type CameraFrame = { cameraId: string; source: "LIVE_CAMERA" | "TEST_VIDEO"; capturedAt: string; tracks: TrackSample[] };
type Detection = { trackId: number; confidence: number; box: number[] };

const iou = (a: number[], b: number[]) => {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h, union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
};

/** One camera, webcam or test video: YOLO people boxes, mapping to the store map, and floor positions per frame. */
export function CameraFeed({ cameraId, source, map, colour, labelFor, onFrame, onRemove }: {
  cameraId: string; source: CameraSource; map: StoreMap; colour: string;
  labelFor: (trackId: number) => string | null; onFrame: (frame: CameraFrame) => void; onRemove: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const stageRef = useRef(false); // True while the setup window is open: sampling pauses.
  const latest = useRef({ map, onFrame, labelFor });
  useEffect(() => { latest.current = { map, onFrame, labelFor }; });
  const [setup, setSetup] = useState<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 640, height: 360, sourceWidth: 0, sourceHeight: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [count, setCount] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const kind = source.kind === "file" ? "TEST_VIDEO" : "LIVE_CAMERA";
  const saved = map.cameras[cameraId];
  const mapping = saved && saved.width === size.sourceWidth && saved.height === size.sourceHeight ? saved.h : null;
  const mappingRef = useRef(mapping);
  useEffect(() => { mappingRef.current = mapping; });

  // Shape outlines projected back onto the image, so staff can see whether the mapping lines up.
  const drawOutlines = useCallback((context: CanvasRenderingContext2D, h: number[], width: number, height: number) => {
    const back = invert(h);
    context.lineWidth = 2;
    for (const shape of latest.current.map.shapes) {
      const points = corners(shape).map(p => project(back, p));
      if (points.some(p => !p)) continue;
      context.strokeStyle = shape.kind === "shelf" ? "#f47b3c" : "#6f9fe8";
      context.setLineDash(shape.kind === "area" ? [8, 5] : []);
      context.beginPath();
      points.forEach((p, i) => i ? context.lineTo(p!.x * width, p!.y * height) : context.moveTo(p!.x * width, p!.y * height));
      context.closePath(); context.stroke();
      context.setLineDash([]);
      context.font = "12px sans-serif"; context.fillStyle = context.strokeStyle;
      context.fillText(shape.label, points[0]!.x * width + 4, points[0]!.y * height - 4);
    }
  }, []);

  useEffect(() => {
    let cancelled = false, stream: MediaStream | null = null, url = "";
    const player = video.current!;
    const session = crypto.randomUUID();
    async function start() {
      try {
        if (source.kind === "device") {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("กล้องต้องใช้ localhost หรือ HTTPS");
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 },
            ...(source.deviceId === "environment" || source.deviceId === "user" ? { facingMode: { ideal: source.deviceId } } : { deviceId: { exact: source.deviceId } }) } });
          if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
          player.srcObject = stream;
        } else {
          url = URL.createObjectURL(source.file);
          player.src = url; player.loop = true;
        }
        await player.play();
        if (cancelled) return;
        const scale = Math.min(1, 640 / player.videoWidth, 720 / player.videoHeight);
        const next = { width: Math.round(player.videoWidth * scale), height: Math.round(player.videoHeight * scale), sourceWidth: player.videoWidth, sourceHeight: player.videoHeight };
        if (!next.width || !next.height) throw new Error("ยังไม่มีภาพจากแหล่งนี้");
        canvas.current!.width = next.width; canvas.current!.height = next.height;
        setSize(next); setRunning(true);
        void capture(next);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? `${cause.name}: ${cause.message}` : "เปิดกล้องไม่ได้");
      }
    }
    async function capture(dimensions: typeof size) {
      if (cancelled) return;
      if (player.videoWidth !== dimensions.sourceWidth || player.videoHeight !== dimensions.sourceHeight) { setError("ขนาดหรือแนวกล้องเปลี่ยน กรุณาลบแล้วเพิ่มกล้องใหม่"); return; }
      if (stageRef.current || document.visibilityState !== "visible") { timer.current = setTimeout(() => void capture(dimensions), 500); return; }
      const frame = document.createElement("canvas");
      frame.width = dimensions.width; frame.height = dimensions.height;
      frame.getContext("2d")!.drawImage(player, 0, 0, frame.width, frame.height);
      const capturedAt = new Date().toISOString(), started = performance.now();
      try {
        const jpeg = await new Promise<Blob | null>(resolve => frame.toBlob(resolve, "image/jpeg", .75));
        if (!jpeg) throw new Error("อ่านภาพไม่สำเร็จ");
        if (cancelled || stageRef.current) return;
        abort.current = new AbortController();
        const response = await fetch("/local-vision/live", { method: "POST", headers: { "content-type": "image/jpeg", "x-camera-session": session },
          body: jpeg, signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(12_000)]) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "YOLO ไม่พร้อม");
        if (result.model !== "yolo11n" || result.imageSize?.width !== frame.width || result.imageSize?.height !== frame.height ||
            !Array.isArray(result.detections) || result.detections.length > 12 || result.detections.some((d: Detection) =>
              !Number.isInteger(d.trackId) || d.trackId < 1 || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1 ||
              !Array.isArray(d.box) || d.box.length !== 4 || !d.box.every(Number.isFinite) || d.box[0] < 0 || d.box[1] < 0 ||
              d.box[2] > frame.width || d.box[3] > frame.height || d.box[2] <= d.box[0] || d.box[3] <= d.box[1])) throw new Error("ผล YOLO ไม่ตรงกับภาพที่ส่ง");
        if (cancelled || stageRef.current) return;
        const found = result.detections as Detection[];
        const h = mappingRef.current;
        const { map: current } = latest.current;
        const tracks: TrackSample[] = found.map(d => {
          const floor = h ? project(h, { x: (d.box[0] + d.box[2]) / 2 / frame.width, y: d.box[3] / frame.height }) : null;
          const inside = floor && floor.x >= 0 && floor.y >= 0 && floor.x <= current.width && floor.y <= current.height;
          return { ...d, floor: inside ? floor : null, occluded: found.some(o => o !== d && iou(o.box, d.box) > .3) };
        });
        const context = canvas.current?.getContext("2d");
        if (!context) return;
        context.drawImage(frame, 0, 0);
        if (h) drawOutlines(context, h, frame.width, frame.height);
        for (const d of tracks) {
          const [x1, y1, x2, y2] = d.box;
          const name = latest.current.labelFor(d.trackId) ?? `#${d.trackId}`;
          context.strokeStyle = d.occluded ? "#ffbf78" : "#c9f56b"; context.lineWidth = 2;
          context.strokeRect(x1, y1, x2 - x1, y2 - y1);
          const label = `${name} ${Math.round(d.confidence * 100)}%${d.occluded ? " · ทับกัน" : ""}`;
          context.font = "12px sans-serif";
          const width = context.measureText(label).width + 8, labelX = Math.max(0, Math.min(x1, frame.width - width));
          context.fillStyle = context.strokeStyle; context.fillRect(labelX, Math.max(0, y1 - 21), width, 21);
          context.fillStyle = "#15251f"; context.fillText(label, labelX + 4, Math.max(14, y1 - 6));
        }
        setCount(found.length); setLatency(Math.round(performance.now() - started)); setError("");
        if (h) latest.current.onFrame({ cameraId, source: kind, capturedAt, tracks });
      } catch (cause) {
        if (cancelled || stageRef.current) return; // Freezing the frame aborts the request on purpose.
        setError(cause instanceof Error ? cause.message : "อ่านภาพไม่สำเร็จ");
        if (!stageRef.current) canvas.current?.getContext("2d")?.drawImage(frame, 0, 0);
      } finally {
        if (!cancelled) timer.current = setTimeout(() => void capture(dimensions), Math.max(100, 500 - (performance.now() - started)));
      }
    }
    void start();
    return () => {
      cancelled = true;
      clearTimeout(timer.current); abort.current?.abort();
      stream?.getTracks().forEach(track => track.stop());
      player.pause(); player.removeAttribute("src"); player.srcObject = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, cameraId, kind, drawOutlines]);

  /** A still of the current picture at full sampling size, tagged with the camera's real resolution for the saved mapping. */
  function snapshot() {
    const player = video.current;
    if (!player || !player.videoWidth) return null;
    const still = document.createElement("canvas");
    still.width = size.width; still.height = size.height;
    still.getContext("2d")!.drawImage(player, 0, 0, size.width, size.height);
    still.dataset.sourceWidth = String(size.sourceWidth); still.dataset.sourceHeight = String(size.sourceHeight);
    return still;
  }
  function openSetup() {
    const still = snapshot();
    if (!still) return;
    stageRef.current = true; abort.current?.abort(); setStatus(""); setError(""); setSetup(still);
  }
  function closeSetup() { stageRef.current = false; setSetup(null); }

  return <article className={styles.feed} style={{ borderColor: colour }}>
    <div className={styles.subheading}>
      <h3><span className={styles.swatch} style={{ background: colour }} /> {cameraId}</h3>
      <span>{source.kind === "file" ? `วิดีโอทดสอบ · ${source.file.name}` : source.label} · {mapping ? "จับคู่แล้ว" : "ยังไม่จับคู่"}</span>
    </div>
    <video ref={video} muted playsInline hidden />
    <div className={styles.camera} style={{ aspectRatio: `${size.width}/${size.height}` }}>
      <canvas ref={canvas} width={size.width} height={size.height} className={styles.liveCanvas} aria-label={`ภาพจาก ${cameraId} พร้อมกรอบคน`} />
      {!running && !error && <p className={styles.cameraPlaceholder}>กำลังเปิด…</p>}
    </div>
    <div className={styles.videoFooter}><span>{running ? `${count} คน` : "—"}{kind === "TEST_VIDEO" ? " · TEST_VIDEO" : ""}</span><span>{latency === null ? "" : `${latency} ms / ภาพ`}</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {status && <p role="status" className={styles.calibration}>{status}</p>}
    <div className={styles.cameraControls}>
      <button type="button" disabled={!running} onClick={openSetup}>{mapping ? "ตั้งค่ากล้องกับแผนที่" : "จับคู่กล้องกับแผนที่"}</button>
      {saved && <button type="button" onClick={() => void deleteCameraMapping(cameraId).catch(() => setError("ลบการจับคู่ไม่สำเร็จ"))}>ลบการจับคู่</button>}
      <button type="button" onClick={onRemove}>ปิดกล้องนี้</button>
    </div>
    {setup && <CameraMapSetup cameraId={cameraId} map={map} saved={saved && saved.width === size.sourceWidth && saved.height === size.sourceHeight ? saved : null}
      snapshot={setup} onRefresh={snapshot} onClose={closeSetup} />}
  </article>;
}
