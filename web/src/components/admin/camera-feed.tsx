"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { deleteCameraMapping, saveCameraMapping, saveStoreMapLayout } from "@/lib/api/client";
import type { StoreMap, StoreShape } from "@/lib/api/types";
import { invert, mappingFromCorners, project, type Point } from "@/lib/camera-calibration";
import { StoreMapView, corners } from "./store-map-view";
import styles from "./customer-detection.module.css";

export type CameraSource = { kind: "device"; deviceId: string; label: string } | { kind: "file"; file: File };
export type TrackSample = { trackId: number; confidence: number; box: number[]; floor: Point | null; occluded: boolean };
export type CameraFrame = { cameraId: string; source: "LIVE_CAMERA" | "TEST_VIDEO"; capturedAt: string; tracks: TrackSample[] };
type Detection = { trackId: number; confidence: number; box: number[] };
type Stage = { mode: "map"; shapeId: string; clicks: { shapeId: string; image: Point }[]; h?: number[] } | { mode: "draw"; clicks: Point[]; kind: StoreShape["kind"]; label: string };

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
        if (cancelled) return;
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

  // While mapping or drawing, show the frozen frame with the clicks and (after computing) the outlines.
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!stage || !frozen.current || !context) return;
    const { width, height } = frozen.current;
    context.drawImage(frozen.current, 0, 0);
    const clicks = stage.mode === "map" ? stage.clicks.map(c => c.image) : stage.clicks;
    clicks.forEach((p, i) => {
      context.fillStyle = "#c9f56b"; context.beginPath(); context.arc(p.x * width, p.y * height, 5, 0, Math.PI * 2); context.fill();
      context.font = "14px sans-serif"; context.fillText(String(i + 1), p.x * width + 8, p.y * height - 6);
    });
    if (stage.mode === "map" && stage.h) drawOutlines(context, stage.h, width, height);
    context.strokeStyle = "#ffffff"; context.lineWidth = 1; context.beginPath();
    context.moveTo(cursor.x * width - 8, cursor.y * height); context.lineTo(cursor.x * width + 8, cursor.y * height);
    context.moveTo(cursor.x * width, cursor.y * height - 8); context.lineTo(cursor.x * width, cursor.y * height + 8); context.stroke();
  }, [stage, cursor, drawOutlines]);

  function freeze(next: Stage) {
    const snapshot = document.createElement("canvas");
    snapshot.width = size.width; snapshot.height = size.height;
    snapshot.getContext("2d")!.drawImage(video.current!, 0, 0, size.width, size.height);
    frozen.current = snapshot; abort.current?.abort(); setStatus(""); setError(""); setStage(next);
  }
  const shapeInMap = (shapeId: string) => map.shapes.find(s => s.id === shapeId);
  const cornerIndex = stage?.mode === "map" ? stage.clicks.filter(c => c.shapeId === stage.shapeId).length : stage?.clicks.length ?? 0;

  function click(point: Point) {
    if (!stage) return;
    if (stage.mode === "map") {
      if (stage.h || cornerIndex >= 4) return;
      setStage({ ...stage, clicks: [...stage.clicks, { shapeId: stage.shapeId, image: point }] });
    } else if (stage.clicks.length < 4) setStage({ ...stage, clicks: [...stage.clicks, point] });
  }
  function compute() {
    if (stage?.mode !== "map") return;
    try {
      const image = stage.clicks.map(c => c.image);
      const target = stage.clicks.map(c => corners(shapeInMap(c.shapeId)!)[stage.clicks.filter(o => o.shapeId === c.shapeId).indexOf(c)]);
      setStage({ ...stage, h: mappingFromCorners(image, target) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "คำนวณไม่สำเร็จ"); }
  }
  async function saveMapping() {
    if (stage?.mode !== "map" || !stage.h) return;
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
    const shape: StoreShape = { id: `area-${Date.now().toString(36)}`, kind: "area", label, x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
    try {
      await saveStoreMapLayout({ version: 1, width: map.width, height: map.height, metresPerUnit: map.metresPerUnit, shapes: [...map.shapes, shape] });
      setStage(null); setStatus(`เพิ่ม “${label}” ลงแผนที่แล้ว ปรับต่อได้ในแท็บแผนที่ร้าน`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เพิ่มพื้นที่ไม่สำเร็จ"); }
  }
  function pointer(event: PointerEvent<HTMLCanvasElement>) {
    if (!stage) return;
    const rect = event.currentTarget.getBoundingClientRect();
    click({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  }
  function keys(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!stage) return;
    if (event.key === "Enter") { event.preventDefault(); click(cursor); }
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      setCursor(p => ({ x: Math.max(0, Math.min(1, p.x + (event.key === "ArrowRight" ? .01 : event.key === "ArrowLeft" ? -.01 : 0))),
        y: Math.max(0, Math.min(1, p.y + (event.key === "ArrowDown" ? .01 : event.key === "ArrowUp" ? -.01 : 0))) }));
    }
  }

  const mapStage = stage?.mode === "map" ? stage : null;
  const currentShape = mapStage ? shapeInMap(mapStage.shapeId) : null;
  const cornerNames = ["ซ้ายบน", "ขวาบน", "ขวาล่าง", "ซ้ายล่าง"];
  return <article className={styles.feed} style={{ borderColor: colour }}>
    <div className={styles.subheading}>
      <h3><span className={styles.swatch} style={{ background: colour }} /> {cameraId}</h3>
      <span>{source.kind === "file" ? `วิดีโอทดสอบ · ${source.file.name}` : source.label} · {mapping ? "จับคู่แล้ว" : "ยังไม่จับคู่"}</span>
    </div>
    <video ref={video} muted playsInline hidden />
    <div className={styles.camera} style={{ aspectRatio: `${size.width}/${size.height}` }}>
      <canvas ref={canvas} width={size.width} height={size.height} className={stage ? styles.calibratingCanvas : styles.liveCanvas}
        onPointerDown={pointer} onKeyDown={keys} tabIndex={stage ? 0 : -1}
        aria-label={`ภาพจาก ${cameraId} พร้อมกรอบคน ระหว่างจับคู่ให้คลิกมุมหรือใช้ลูกศรแล้วกด Enter`} />
      {!running && !error && <p className={styles.cameraPlaceholder}>กำลังเปิด…</p>}
    </div>
    <div className={styles.videoFooter}><span>{running ? `${count} คน` : "—"}{kind === "TEST_VIDEO" ? " · TEST_VIDEO" : ""}</span><span>{latency === null ? "" : `${latency} ms / ภาพ`}</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {status && <p role="status" className={styles.calibration}>{status}</p>}

    {!stage && <div className={styles.cameraControls}>
      <button type="button" disabled={!running || !map.shapes.length} onClick={() => freeze({ mode: "map", shapeId: map.shapes[0].id, clicks: [] })}>{mapping ? "จับคู่ใหม่" : "จับคู่กล้องกับแผนที่"}</button>
      <button type="button" disabled={!running || !mapping} onClick={() => freeze({ mode: "draw", clicks: [], kind: "area", label: "" })}>วาดพื้นที่จากกล้องนี้</button>
      {saved && <button type="button" onClick={() => void deleteCameraMapping(cameraId).catch(() => setError("ลบการจับคู่ไม่สำเร็จ"))}>ลบการจับคู่</button>}
      <button type="button" onClick={onRemove}>ปิดกล้องนี้</button>
    </div>}

    {mapStage && currentShape && <div className={styles.calibrationPrompt} role="status">
      <div className={styles.wizard}>
        <StoreMapView map={map} selectedId={mapStage.h ? null : currentShape.id} cornerHint={mapStage.h ? null : Math.min(cornerIndex, 3)} className={styles.miniMap} label={`มุมที่ต้องคลิกของ ${currentShape.label}`} />
        <div>
          {mapStage.h ? <p>ดูเส้นกรอบบนภาพ ถ้าตรงกับ Shelf/พื้นที่จริง กดบันทึก ถ้าไม่ตรง กดเริ่มใหม่</p>
            : cornerIndex < 4 ? <p>คลิก <b>มุม{cornerNames[cornerIndex]}</b> ของ <b>{currentShape.label}</b> บนพื้นในภาพ ({cornerIndex + 1}/4) · จุดสีส้มบนแผนที่เล็กคือมุมที่ต้องคลิก</p>
            : <p>ครบ 4 มุมของ {currentShape.label} แล้ว ({mapStage.clicks.length} จุด) เลือกรูปทรงอื่นเพิ่มเพื่อความแม่นยำ หรือกดคำนวณ</p>}
          {!mapStage.h && <label>รูปทรง <select value={mapStage.shapeId} disabled={cornerIndex > 0 && cornerIndex < 4} onChange={e => setStage({ ...mapStage, shapeId: e.target.value })}>
            {map.shapes.map(shape => <option key={shape.id} value={shape.id} disabled={mapStage.clicks.some(c => c.shapeId === shape.id)}>{shape.label}</option>)}
          </select></label>}
          <div className={styles.cameraControls}>
            {!mapStage.h && <button type="button" disabled={mapStage.clicks.length < 4 || cornerIndex % 4 !== 0} onClick={compute}>คำนวณ</button>}
            {mapStage.h && <button type="button" className={styles.primary} onClick={() => void saveMapping()}>บันทึก</button>}
            <button type="button" onClick={() => setStage({ mode: "map", shapeId: map.shapes[0].id, clicks: [] })}>เริ่มใหม่</button>
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
