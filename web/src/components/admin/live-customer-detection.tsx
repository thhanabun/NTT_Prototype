"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { MapView } from "@/lib/admin-commands";
import { floorHomography, projectFloor, type Point } from "@/lib/camera-calibration";
import styles from "./customer-detection.module.css";

type Detection = { trackId: number; confidence: number; box: number[] };
type Sample = { time: number; points: { trackId: number; point: Point }[] };
type Calibration = { h: number[]; shelves: Point[] };
const mapPoint = (p: Point) => ({ x: 40 + p.x * 480, y: 28 + p.y * 320 });
const floorLabels = ["ซ้ายบน", "ขวาบน", "ขวาล่าง", "ซ้ายล่าง"];

export function LiveCustomerDetection({ view, onViewChange, active }: { view: MapView; onViewChange: (view: MapView) => void; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const stageRef = useRef<"floor" | "shelves" | null>(null);
  const calibration = useRef<Calibration | null>(null);
  const temporaryH = useRef<number[] | null>(null);
  const frozen = useRef<HTMLCanvasElement | null>(null);
  const bindingsRef = useRef<Record<number, string>>({});
  const [bindings, setBindings] = useState<Record<number, string>>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("environment");
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ width: 640, height: 360 });
  const [detections, setDetections] = useState<Detection[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [stage, setStage] = useState<"floor" | "shelves" | null>(null);
  const [anchors, setAnchors] = useState<Point[]>([]);
  const [shelfAnchors, setShelfAnchors] = useState<Point[]>([]);
  const [calibrated, setCalibrated] = useState(false);
  const [shelves, setShelves] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point>({ x: .5, y: .5 });

  const stop = useCallback(() => {
    epoch.current++;
    abort.current?.abort();
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    canvas.current?.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
    stageRef.current = null; calibration.current = null; frozen.current = null; temporaryH.current = null;
    setRunning(false); setConnecting(false); setDetections([]); setSamples([]); setCalibrated(false); setStage(null);
    setAnchors([]); setShelfAnchors([]); setLatency(null); setShelves([]); setError("");
  }, []);
  useEffect(() => () => stop(), [stop]);

  async function start() {
    stop(); setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("กล้องต้องใช้ localhost หรือ HTTPS หากเปิดบนมือถือผ่าน IP ของคอม ให้ใช้ HTTPS"); return;
    }
    const generation = epoch.current;
    setConnecting(true);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 1280 }, height: { ideal: 720 },
        ...(device === "environment" || device === "user" ? { facingMode: { ideal: device } } : { deviceId: { exact: device } }),
      } });
      if (generation !== epoch.current) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired;
      acquired.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
      const player = video.current!;
      player.srcObject = acquired;
      await player.play();
      if (generation !== epoch.current) return;
      const scale = Math.min(640 / player.videoWidth, 720 / player.videoHeight);
      const dimensions = { width: Math.round(player.videoWidth * scale), height: Math.round(player.videoHeight * scale) };
      const sourceSize = { width: player.videoWidth, height: player.videoHeight };
      if (!dimensions.width || !dimensions.height) throw new Error("กล้องยังไม่มีภาพ กรุณาเชื่อมต่อใหม่");
      setSize(dimensions);
      canvas.current!.width = dimensions.width; canvas.current!.height = dimensions.height;
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === "videoinput"));
      if (generation !== epoch.current) return;
      setRunning(true); setConnecting(false);
      bindingsRef.current = {}; setBindings({});
      const session = crypto.randomUUID();
      async function capture() {
        if (generation !== epoch.current) return;
        if (player.videoWidth !== sourceSize.width || player.videoHeight !== sourceSize.height) {
          stop(); setError("ขนาดหรือแนวกล้องเปลี่ยน กรุณาเชื่อมต่อและปรับเทียบใหม่"); return;
        }
        if (stageRef.current || document.visibilityState !== "visible") { timer.current = setTimeout(capture, 500); return; }
        const frame = document.createElement("canvas");
        frame.width = dimensions.width; frame.height = dimensions.height;
        frame.getContext("2d")!.drawImage(player, 0, 0, frame.width, frame.height);
        const started = performance.now();
        try {
          const jpeg = await new Promise<Blob | null>(resolve => frame.toBlob(resolve, "image/jpeg", .75));
          if (!jpeg) throw new Error("อ่านภาพจากกล้องไม่สำเร็จ");
          if (generation !== epoch.current || stageRef.current) return;
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
          if (generation !== epoch.current || stageRef.current) return;
          const found = result.detections as Detection[];
          const context = canvas.current?.getContext("2d");
          if (!context) return;
          context.drawImage(frame, 0, 0);
          for (const d of found) {
            const [x1, y1, x2, y2] = d.box;
            const basket = bindingsRef.current[d.trackId];
            context.strokeStyle = basket === "A" ? "#c9f56b" : basket === "B" ? "#71c9ff" : "#ffbf78";
            context.lineWidth = 2;
            context.strokeRect(x1, y1, x2 - x1, y2 - y1);
            const label = `Customer ${basket ? `| Basket ${basket}` : `#${d.trackId}`} det ${Math.round(d.confidence * 100)}%`;
            context.font = "12px sans-serif";
            const labelX = Math.max(0, Math.min(x1, frame.width - context.measureText(label).width - 8));
            context.fillStyle = context.strokeStyle;
            context.fillRect(labelX, Math.max(0, y1 - 21), context.measureText(label).width + 8, 21);
            context.fillStyle = "#15251f"; context.fillText(label, labelX + 4, Math.max(14, y1 - 6));
          }
          setDetections(found); setLatency(Math.round(performance.now() - started)); setError("");
          if (calibration.current) {
            const h = calibration.current.h;
            const points = found.flatMap(d => {
              const point = projectFloor({ x: (d.box[0] + d.box[2]) / 2 / frame.width, y: d.box[3] / frame.height }, h);
              return point ? [{ trackId: d.trackId, point }] : [];
            });
            setSamples(current => [...current.slice(-599), { time: performance.now(), points }]);
          }
        } catch (cause) {
          if (generation !== epoch.current) return;
          setDetections([]);
          setError(cause instanceof Error ? cause.message : "อ่านภาพไม่สำเร็จ");
          if (!stageRef.current) canvas.current?.getContext("2d")?.drawImage(frame, 0, 0);
        } finally {
          if (generation === epoch.current) timer.current = setTimeout(capture, Math.max(100, 500 - (performance.now() - started)));
        }
      }
      void capture();
    } catch (cause) {
      if (generation !== epoch.current) return;
      stop(); setError(cause instanceof Error ? `${cause.name}: ${cause.message}` : "เชื่อมต่อกล้องไม่ได้");
    }
  }

  function beginCalibration() {
    const snapshot = document.createElement("canvas"); snapshot.width = size.width; snapshot.height = size.height;
    snapshot.getContext("2d")!.drawImage(video.current!, 0, 0, size.width, size.height);
    frozen.current = snapshot; stageRef.current = "floor"; temporaryH.current = null; calibration.current = null;
    setStage("floor"); setAnchors([]); setShelfAnchors([]); setSamples([]); setCalibrated(false); setError("");
  }
  useEffect(() => {
    if (!stage || !frozen.current) return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.drawImage(frozen.current, 0, 0);
    [...anchors, ...shelfAnchors].forEach((point, i) => {
      context.fillStyle = i < 4 ? "#c9f56b" : "#71c9ff";
      context.beginPath(); context.arc(point.x * size.width, point.y * size.height, 5, 0, Math.PI * 2); context.fill();
      context.font = "15px sans-serif"; context.fillText(i < 4 ? String(i + 1) : `Shelf ${i - 3}`, point.x * size.width + 9, point.y * size.height - 5);
    });
    context.strokeStyle = "#ffffff"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(cursor.x * size.width - 8, cursor.y * size.height); context.lineTo(cursor.x * size.width + 8, cursor.y * size.height);
    context.moveTo(cursor.x * size.width, cursor.y * size.height - 8); context.lineTo(cursor.x * size.width, cursor.y * size.height + 8); context.stroke();
  }, [stage, anchors, shelfAnchors, size, cursor]);

  function selectAnchor(event: PointerEvent<HTMLCanvasElement>) {
    if (!stage) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    addAnchor(point);
  }
  function addAnchor(point: Point) {
    if (!stage) return;
    setError("");
    try {
      if (stage === "floor") {
        const next = [...anchors, point];
        if (next.length === 4) { temporaryH.current = floorHomography(next); stageRef.current = "shelves"; setStage("shelves"); }
        setAnchors(next);
      } else {
        const projected = projectFloor(point, temporaryH.current!);
        if (!projected) throw new Error("เลือกจุดกึ่งกลางฐาน Shelf บนพื้นที่กำหนด");
        if (shelfAnchors.some(other => Math.hypot(other.x - point.x, other.y - point.y) < .04)) throw new Error("เลือก Shelf คนละตำแหน่ง");
        const next = [...shelfAnchors, point]; setShelfAnchors(next);
        if (next.length === 3) {
          calibration.current = { h: temporaryH.current!, shelves: next.map(p => projectFloor(p, temporaryH.current!)!) };
          setShelves(calibration.current.shelves);
          stageRef.current = null; setStage(null); setCalibrated(true); setSamples([]);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ปรับเทียบไม่สำเร็จ");
      if (stage === "floor") setAnchors([]);
    }
  }

  function bind(trackId: number, basket: string) {
    const next = Object.fromEntries(Object.entries(bindingsRef.current).filter(([id, value]) => Number(id) !== trackId && (!basket || value !== basket)));
    if (basket) next[trackId] = basket;
    bindingsRef.current = next; setBindings(next);
  }
  const color = (id: number) => bindings[id] === "A" ? "#c9f56b" : bindings[id] === "B" ? "#71c9ff" : "#e8a45e";
  const label = (id: number) => bindings[id] || `#${id}`;
  const current = error || stage ? [] : samples.at(-1)?.points.filter(p => detections.some(d => d.trackId === p.trackId)) ?? [];
  const recent = samples.filter(s => s.time >= (samples.at(-1)?.time ?? 0) - 6_000);

  return <>
    <div className={styles.cameraControls}>
      <label>กล้อง <select value={device} disabled={connecting} onChange={event => { stop(); setDevice(event.target.value); }}>
        <option value="environment">กล้องหลัง / กล้องหลัก</option><option value="user">กล้องหน้า</option>
        {devices.map((item, i) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Camera ${i + 1}`}</option>)}
      </select></label>
      <button type="button" disabled={connecting || running || !active} onClick={() => void start()}>{connecting ? "กำลังเชื่อมต่อ…" : "เชื่อมต่อกล้อง"}</button>
      <button type="button" disabled={!running && !connecting} onClick={stop}>หยุดกล้อง</button>
      <button type="button" disabled={!running} onClick={beginCalibration}>ปรับเทียบแผนที่</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {stage && <div className={styles.calibrationPrompt} role="status">
      {stage === "floor" ? `แตะมุมพื้นที่บนพื้น: ${floorLabels[anchors.length]} (${anchors.length + 1}/4)` : `แตะกึ่งกลางฐาน Shelf ${shelfAnchors.length + 1} บนพื้น (${shelfAnchors.length + 1}/3)`}
      <button type="button" onClick={beginCalibration}>เริ่มใหม่</button>
      <button type="button" onClick={() => { stageRef.current = null; setStage(null); }}>ยกเลิก</button>
    </div>}
    <div className={styles.content}>
      <div className={styles.cameraPanel}>
        <div className={styles.subheading}><h3>กล้องสด · Customer</h3><span>{running ? "YOLO11n + ByteTrack" : "ยังไม่เชื่อมต่อ"}</span></div>
        <video ref={video} muted playsInline hidden />
        <div className={styles.camera} style={{ aspectRatio: `${size.width}/${size.height}` }}>
          <canvas ref={canvas} width={size.width} height={size.height} className={stage ? styles.calibratingCanvas : styles.liveCanvas} onPointerDown={selectAnchor}
            tabIndex={stage ? 0 : -1} aria-label="ภาพกล้องพร้อมกรอบ Customer เลือกจุดด้วยเมาส์หรือใช้ลูกศรแล้ว Enter"
            onKeyDown={event => {
              if (!stage) return;
              if (event.key === "Enter") { event.preventDefault(); addAnchor(cursor); }
              if (event.key.startsWith("Arrow")) { event.preventDefault(); setCursor(p => ({
                x: Math.max(0, Math.min(1, p.x + (event.key === "ArrowRight" ? .01 : event.key === "ArrowLeft" ? -.01 : 0))),
                y: Math.max(0, Math.min(1, p.y + (event.key === "ArrowDown" ? .01 : event.key === "ArrowUp" ? -.01 : 0))),
              })); }
            }} />
          {!running && <p className={styles.cameraPlaceholder}>เลือกกล้องแล้วกดเชื่อมต่อ</p>}
        </div>
        <div className={styles.videoFooter}><span>{running ? `${detections.length} Customers` : "กล้องปิด"}</span><span>{latency === null ? "" : `${latency} ms / frame`}</span></div>
        {detections.length > 0 && <div className={styles.bindings}>{detections.map(d => <label key={d.trackId}>Customer #{d.trackId}
          <select aria-label={`ผูก Customer ${d.trackId} กับตะกร้า`} value={bindings[d.trackId] || ""} onChange={event => bind(d.trackId, event.target.value)}>
            <option value="">ยังไม่ผูกตะกร้า</option><option value="A">Basket A</option><option value="B">Basket B</option>
          </select></label>)}</div>}
      </div>
      <div className={styles.mapPanel}>
        <div className={styles.subheading}><h3>Customer map</h3><div className={styles.toggle} role="group" aria-label="รูปแบบแผนที่กล้องสด">
          <button type="button" aria-pressed={view === "points"} onClick={() => onViewChange("points")}>จุด</button>
          <button type="button" aria-pressed={view === "heatmap"} onClick={() => onViewChange("heatmap")}>Heatmap</button>
        </div></div>
        <svg className={styles.map} viewBox="0 0 560 390" role="img" aria-label="แผนที่ Customer จากกล้องสด">
          <defs><radialGradient id="live-heat"><stop offset="0" stopColor="#ff9548" stopOpacity=".25" /><stop offset="1" stopColor="#98d596" stopOpacity="0" /></radialGradient></defs>
          <rect x="14" y="14" width="532" height="362" rx="16" fill="var(--c-bg)" stroke="var(--c-line)" />
          {!calibrated && <text x="280" y="190" textAnchor="middle" fill="var(--c-soft)" fontSize="14">ปรับเทียบพื้น 4 จุดและตำแหน่ง Shelf ก่อน</text>}
          {calibrated && shelves.map((p, i) => { const m = mapPoint(p); return <g key={i}><rect x={m.x - 38} y={m.y - 18} width="76" height="36" rx="6" fill="var(--c-surface2)" stroke="var(--c-line)" /><text x={m.x} y={m.y + 5} textAnchor="middle" fill="var(--c-ink)" fontSize="13">Shelf {i + 1}</text></g>; })}
          {(view === "heatmap" ? samples.filter((_, i) => i % 2 === 0) : recent).map((sample, i) => sample.points.map(p => {
            const m = mapPoint(p.point);
            return <circle key={`${i}-${p.trackId}`} cx={m.x} cy={m.y} r={view === "heatmap" ? 25 : 2} fill={view === "heatmap" ? "url(#live-heat)" : color(p.trackId)} opacity={view === "heatmap" ? 1 : .5} />;
          }))}
          {current.map(p => { const m = mapPoint(p.point); return <g key={p.trackId}><circle cx={m.x} cy={m.y} r="7" fill={color(p.trackId)} stroke="var(--c-ink)" /><text x={m.x} y={m.y - 14} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--c-ink)">{label(p.trackId)}</text></g>; })}
        </svg>
        <p className={styles.calibration}>ตั้งกล้องให้นิ่ง เลือกจุดบนพื้น ไม่เลือกบนโต๊ะ หากย้ายกล้องหรือหมุนเครื่องให้ปรับเทียบใหม่ · พิกัดประมาณ ไม่มีสเกลเมตร</p>
        <p className={styles.calibration}>ผูก Basket A/B ด้วยตัวเอง การบังกันหรือเดินออกนอกภาพอาจทำให้ track ID เปลี่ยน</p>
      </div>
    </div>
  </>;
}
