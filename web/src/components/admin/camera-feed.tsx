"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { deleteCameraMapping, saveCameraMapping, saveStoreMapLayout } from "@/lib/api/client";
import type { StoreMap, StoreShape } from "@/lib/api/types";
import { fitHomography, homography, invert, project, type Point } from "@/lib/camera-calibration";
import { StoreMapView, corners } from "./store-map-view";
import styles from "./customer-detection.module.css";

export type CameraSource = { kind: "device"; deviceId: string; label: string } | { kind: "file"; file: File };
export type TrackSample = { trackId: number; confidence: number; box: number[]; floor: Point | null; occluded: boolean };
export type CameraFrame = { cameraId: string; source: "LIVE_CAMERA" | "TEST_VIDEO"; capturedAt: string; tracks: TrackSample[] };
type Detection = { trackId: number; confidence: number; box: number[] };
/** Fit: every map shape is drawn on the frozen image; staff drag its corners onto the real ones. `pinned` are corners placed by hand. */
type Fit = { mode: "fit"; points: Record<string, Point[]>; pinned: string[]; h: number[] };
type Stage = Fit | { mode: "draw"; clicks: Point[]; label: string };
const cornerKey = (shapeId: string, i: number) => `${shapeId}:${i}`;

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
  const frozen = useRef<HTMLCanvasElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const latest = useRef({ map, onFrame, labelFor });
  useEffect(() => { latest.current = { map, onFrame, labelFor }; });
  const [stage, setStageState] = useState<Stage | null>(null);
  const [size, setSize] = useState({ width: 640, height: 360, sourceWidth: 0, sourceHeight: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [count, setCount] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: .5, y: .5 });
  const kind = source.kind === "file" ? "TEST_VIDEO" : "LIVE_CAMERA";
  const saved = map.cameras[cameraId];
  const mapping = saved && saved.width === size.sourceWidth && saved.height === size.sourceHeight ? saved.h : null;
  const mappingRef = useRef(mapping);
  useEffect(() => { mappingRef.current = mapping; });
  const setStage = (next: Stage | null) => { stageRef.current = next; setStageState(next); };

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

  const [history, setHistory] = useState<Stage[]>([]);
  const dragKey = useRef<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const shapeById = (id: string) => map.shapes.find(s => s.id === id)!;

  /** Re-solve the mapping from the hand-placed corners; unplaced corners follow the new mapping. */
  function refit(points: Record<string, Point[]>, pinned: string[], previous: number[]): { points: Record<string, Point[]>; h: number[] } {
    const pairs = pinned.map(key => { const [id, i] = key.split(":"); return { image: points[id][+i], map: corners(shapeById(id))[+i] }; });
    // With fewer than 4 hand-placed corners, keep the rest of those shapes' corners where they are (a perspective "corner drag").
    for (const id of [...new Set(pinned.map(key => key.split(":")[0]))]) for (let i = 0; i < 4 && pairs.length < 4; i++)
      if (!pinned.includes(cornerKey(id, i))) pairs.push({ image: points[id][i], map: corners(shapeById(id))[i] });
    if (pairs.length < 4) return { points, h: previous };
    let h: number[];
    try { h = fitHomography(pairs.map(p => p.image), pairs.map(p => p.map)); } catch { return { points, h: previous }; }
    const back = invert(h);
    return { h, points: Object.fromEntries(map.shapes.map(shape => [shape.id, corners(shape).map((p, i) =>
      pinned.includes(cornerKey(shape.id, i)) ? points[shape.id][i] : project(back, p) ?? points[shape.id][i])])) };
  }
  function startFit() {
    // Start from the saved mapping, or a rough guess with the map seen from the front.
    const h = mapping ?? homography([{ x: .25, y: .35 }, { x: .75, y: .35 }, { x: .95, y: .95 }, { x: .05, y: .95 }],
      [{ x: 0, y: 0 }, { x: map.width, y: 0 }, { x: map.width, y: map.height }, { x: 0, y: map.height }]);
    const back = invert(h);
    setHistory([]);
    setSelectedKey(null);
    freeze({ mode: "fit", h, pinned: [], points: Object.fromEntries(map.shapes.map(shape => [shape.id, corners(shape).map(p => project(back, p) ?? { x: .5, y: .5 })])) });
  }
  function moveCorner(fit: Fit, key: string, point: Point) {
    const [id, i] = key.split(":");
    const points = { ...fit.points, [id]: fit.points[id].map((p, k) => k === +i ? { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) } : p) };
    const pinned = fit.pinned.includes(key) ? fit.pinned : [...fit.pinned, key];
    setStage({ mode: "fit", pinned, ...refit(points, pinned, fit.h) });
  }
  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    stageRef.current = previous; setStageState(previous);
  }, [history]);
  useEffect(() => {
    if (stage?.mode !== "fit") return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage?.mode, undo]);

  // While fitting or drawing, show the frozen frame with the outlines / clicks.
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!stage || !frozen.current || !context) return;
    const { width, height } = frozen.current;
    context.drawImage(frozen.current, 0, 0);
    if (stage.mode === "fit") {
      for (const shape of map.shapes) {
        const pts = stage.points[shape.id];
        if (!pts) continue;
        context.strokeStyle = shape.kind === "shelf" ? "#f47b3c" : "#6f9fe8"; context.lineWidth = 2;
        context.setLineDash(shape.kind === "area" ? [8, 5] : []);
        context.beginPath(); pts.forEach((p, i) => i ? context.lineTo(p.x * width, p.y * height) : context.moveTo(p.x * width, p.y * height)); context.closePath(); context.stroke();
        context.setLineDash([]);
        const cx = pts.reduce((s, p) => s + p.x, 0) / 4 * width, cy = pts.reduce((s, p) => s + p.y, 0) / 4 * height;
        context.font = "bold 13px sans-serif"; context.fillStyle = context.strokeStyle; context.textAlign = "center"; context.fillText(shape.label, cx, cy); context.textAlign = "start";
        pts.forEach((p, i) => {
          const key = cornerKey(shape.id, i), pinned = stage.pinned.includes(key);
          context.beginPath(); context.arc(p.x * width, p.y * height, pinned ? 7 : 6, 0, Math.PI * 2);
          context.fillStyle = pinned ? "#c9f56b" : "rgba(255,255,255,.85)"; context.fill();
          context.lineWidth = key === selectedKey ? 3 : 1.5; context.strokeStyle = "#15251f"; context.stroke();
        });
      }
    } else {
      stage.clicks.forEach((p, i) => {
        context.fillStyle = "#c9f56b"; context.beginPath(); context.arc(p.x * width, p.y * height, 5, 0, Math.PI * 2); context.fill();
        context.font = "14px sans-serif"; context.fillText(String(i + 1), p.x * width + 8, p.y * height - 6);
      });
      context.strokeStyle = "#ffffff"; context.lineWidth = 1; context.beginPath();
      context.moveTo(cursor.x * width - 8, cursor.y * height); context.lineTo(cursor.x * width + 8, cursor.y * height);
      context.moveTo(cursor.x * width, cursor.y * height - 8); context.lineTo(cursor.x * width, cursor.y * height + 8); context.stroke();
    }
  }, [stage, cursor, selectedKey, map.shapes]);

  function freeze(next: Stage) {
    const snapshot = document.createElement("canvas");
    snapshot.width = size.width; snapshot.height = size.height;
    snapshot.getContext("2d")!.drawImage(video.current!, 0, 0, size.width, size.height);
    frozen.current = snapshot; abort.current?.abort(); setStatus(""); setError(""); setStage(next);
  }
  async function saveMapping() {
    if (stage?.mode !== "fit") return;
    try {
      await saveCameraMapping(cameraId, { width: size.sourceWidth, height: size.sourceHeight, h: stage.h });
      setStage(null); setStatus("บันทึกการจับคู่กล้องแล้ว คนที่กล้องเห็นจะขึ้นบนแผนที่ร้าน");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); }
  }
  async function addShape() {
    if (stage?.mode !== "draw" || stage.clicks.length < 4 || !mapping) return;
    const points = stage.clicks.map(p => project(mapping, p));
    if (points.some(p => !p)) { setError("มุมบางจุดอยู่นอกพื้นที่ที่กล้องจับคู่ได้"); return; }
    const xs = points.map(p => Math.min(map.width, Math.max(0, p!.x))), ys = points.map(p => Math.min(map.height, Math.max(0, p!.y)));
    const x = Math.min(...xs), y = Math.min(...ys);
    const label = stage.label.trim() || "พื้นที่ใหม่";
    const shape: StoreShape = { id: `area-${Date.now().toString(36)}`, kind: "area", label, x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y), angle: 0 };
    try {
      await saveStoreMapLayout({ version: 1, width: map.width, height: map.height, metresPerUnit: map.metresPerUnit, shapes: [...map.shapes, shape] });
      setStage(null); setStatus(`เพิ่ม “${label}” ลงแผนที่แล้ว ปรับต่อได้ในแท็บแผนที่ร้าน`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เพิ่มพื้นที่ไม่สำเร็จ"); }
  }
  const toImage = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { point: { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, rect };
  };
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (!stage) return;
    const { point, rect } = toImage(event);
    if (stage.mode === "draw") { if (stage.clicks.length < 4) setStage({ ...stage, clicks: [...stage.clicks, point] }); return; }
    let best: { key: string; d: number } | null = null;
    for (const [id, pts] of Object.entries(stage.points)) pts.forEach((p, i) => {
      const d = Math.hypot((p.x - point.x) * rect.width, (p.y - point.y) * rect.height);
      if (d <= 22 && (!best || d < best.d)) best = { key: cornerKey(id, i), d };
    });
    const picked = best as { key: string; d: number } | null;
    if (!picked) return;
    setHistory(h => [...h.slice(-49), stage]);
    dragKey.current = picked.key; setSelectedKey(picked.key);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function drag(event: PointerEvent<HTMLCanvasElement>) {
    if (stage?.mode !== "fit" || !dragKey.current) return;
    moveCorner(stage, dragKey.current, toImage(event).point);
  }
  function keys(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!stage) return;
    if (stage.mode === "draw") {
      if (event.key === "Enter") { event.preventDefault(); if (stage.clicks.length < 4) setStage({ ...stage, clicks: [...stage.clicks, cursor] }); }
      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        setCursor(p => ({ x: Math.max(0, Math.min(1, p.x + (event.key === "ArrowRight" ? .01 : event.key === "ArrowLeft" ? -.01 : 0))),
          y: Math.max(0, Math.min(1, p.y + (event.key === "ArrowDown" ? .01 : event.key === "ArrowUp" ? -.01 : 0))) }));
      }
      return;
    }
    // Keyboard fitting: N picks the next corner, arrows move it (Shift = bigger steps).
    const order = map.shapes.flatMap(shape => [0, 1, 2, 3].map(i => cornerKey(shape.id, i)));
    if (event.key.toLowerCase() === "n") { event.preventDefault(); setSelectedKey(k => order[(order.indexOf(k ?? "") + 1) % order.length]); return; }
    if (!selectedKey || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const step = event.shiftKey ? .02 : .004, [id, i] = selectedKey.split(":"), p = stage.points[id][+i];
    setHistory(h => [...h.slice(-49), stage]);
    moveCorner(stage, selectedKey, { x: p.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: p.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
  }

  const fit = stage?.mode === "fit" ? stage : null;
  const shapesFitted = fit ? new Set(fit.pinned.map(key => key.split(":")[0])).size : 0;
  return <article className={styles.feed} style={{ borderColor: colour }}>
    <div className={styles.subheading}>
      <h3><span className={styles.swatch} style={{ background: colour }} /> {cameraId}</h3>
      <span>{source.kind === "file" ? `วิดีโอทดสอบ · ${source.file.name}` : source.label} · {mapping ? "จับคู่แล้ว" : "ยังไม่จับคู่"}</span>
    </div>
    <video ref={video} muted playsInline hidden />
    <div className={styles.camera} style={{ aspectRatio: `${size.width}/${size.height}` }}>
      <canvas ref={canvas} width={size.width} height={size.height} className={stage ? styles.calibratingCanvas : styles.liveCanvas}
        onPointerDown={down} onPointerMove={drag} onPointerUp={() => { dragKey.current = null; }} onPointerCancel={() => { dragKey.current = null; }}
        onKeyDown={keys} tabIndex={stage ? 0 : -1}
        aria-label={fit ? `ภาพจาก ${cameraId}: ลากจุดมุมของเส้นกรอบไปวางบนมุมจริงที่พื้น หรือกด N เลือกมุมแล้วใช้ลูกศร` : `ภาพจาก ${cameraId} พร้อมกรอบคน`} />
      {!running && !error && <p className={styles.cameraPlaceholder}>กำลังเปิด…</p>}
    </div>
    <div className={styles.videoFooter}><span>{running ? `${count} คน` : "—"}{kind === "TEST_VIDEO" ? " · TEST_VIDEO" : ""}</span><span>{latency === null ? "" : `${latency} ms / ภาพ`}</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {status && <p role="status" className={styles.calibration}>{status}</p>}

    {!stage && <div className={styles.cameraControls}>
      <button type="button" disabled={!running || !map.shapes.length} onClick={startFit}>{mapping ? "ปรับการจับคู่" : "จับคู่กล้องกับแผนที่"}</button>
      <button type="button" disabled={!running || !mapping} onClick={() => freeze({ mode: "draw", clicks: [], label: "" })}>วาดพื้นที่จากกล้องนี้</button>
      {saved && <button type="button" onClick={() => void deleteCameraMapping(cameraId).catch(() => setError("ลบการจับคู่ไม่สำเร็จ"))}>ลบการจับคู่</button>}
      <button type="button" onClick={onRemove}>ปิดกล้องนี้</button>
    </div>}

    {fit && <div className={styles.calibrationPrompt} role="status">
      <div className={styles.wizard}>
        <StoreMapView map={map} className={styles.miniMap} label="แผนที่ร้าน ใช้ดูว่ากรอบไหนคือ Shelf ไหน" />
        <div>
          <p>ลาก <b>จุดมุม</b> ของเส้นกรอบไปวางบน <b>มุมจริงที่พื้น</b> ของ Shelf/พื้นที่ในภาพ เส้นกรอบอื่นจะขยับตามทันที · เริ่มจาก Shelf ที่เห็นชัดที่สุดให้ครบ 4 มุม แล้วค่อยแก้ Shelf อื่นที่ยังไม่ตรง · จุดสีเขียว = วางแล้ว</p>
          <p className={styles.muted}>วางแล้ว {fit.pinned.length} มุม จาก {shapesFitted} รูปทรง · Ctrl+Z ย้อนกลับ · คีย์บอร์ด: N เลือกมุมถัดไป, ลูกศรเลื่อน</p>
          <div className={styles.cameraControls}>
            <button type="button" className={styles.primary} disabled={fit.pinned.length < 4 && !mapping} onClick={() => void saveMapping()}>บันทึก</button>
            <button type="button" disabled={!history.length} onClick={undo}>↶ ย้อนกลับ</button>
            <button type="button" onClick={startFit}>เริ่มใหม่</button>
            <button type="button" onClick={() => setStage(null)}>ยกเลิก</button>
          </div>
        </div>
      </div>
    </div>}

    {stage?.mode === "draw" && <div className={styles.calibrationPrompt} role="status">
      <p>{stage.clicks.length < 4 ? `คลิกมุมบนพื้นของพื้นที่ใหม่ ${stage.clicks.length + 1}/4 (เรียงรอบรูป)` : "ตั้งชื่อแล้วกดเพิ่มลงแผนที่"}</p>
      <label>ชื่อพื้นที่ <input value={stage.label} maxLength={40} placeholder="เช่น แคชเชียร์" onChange={e => setStage({ ...stage, label: e.target.value })} /></label>
      <div className={styles.cameraControls}>
        <button type="button" className={styles.primary} disabled={stage.clicks.length < 4} onClick={() => void addShape()}>เพิ่มลงแผนที่</button>
        <button type="button" onClick={() => setStage({ ...stage, clicks: [] })}>เริ่มใหม่</button>
        <button type="button" onClick={() => setStage(null)}>ยกเลิก</button>
      </div>
    </div>}
  </article>;
}
