"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, ScanLine, Users, Video } from "lucide-react";
import { customerRecording as recording, recordingFrameIndex, trackSegments } from "@/lib/customer-tracking";
import styles from "./customer-detection.module.css";
import type { MapView } from "@/lib/admin-commands";
import { LiveCustomerDetection } from "./live-customer-detection";

const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const mapPoint = ({ x, y }: { x: number; y: number }) => ({ x: 40 + x * 480, y: 28 + y * 320 });

export function CustomerDetection({ view, onViewChange, active }: { view: MapView; onViewChange: (view: MapView) => void; active: boolean }) {
  const [source, setSource] = useState<"recording" | "live">("recording");
  return <section className={styles.panel} aria-labelledby="customer-detection-heading">
    <header className={styles.heading}>
      <div><p>STORE VISION</p><h2 id="customer-detection-heading">Object Detection</h2></div>
      <span className={styles.sourceBadge}>YOLO11n · {source === "recording" ? "คลิปจริง" : "กล้องสด"}</span>
    </header>
    <div className={styles.sourceControls} role="group" aria-label="แหล่งภาพ Object Detection">
      <button type="button" aria-pressed={source === "recording"} onClick={() => setSource("recording")}>คลิปจริง</button>
      <button type="button" aria-pressed={source === "live"} onClick={() => setSource("live")}>กล้องสด</button>
    </div>
    {source === "recording" ? <RecordedCustomerDetection view={view} onViewChange={onViewChange} active={active} /> : active ? <LiveCustomerDetection view={view} onViewChange={onViewChange} active={active} /> : <p>กล้องหยุดเมื่อออกจาก Dashboard</p>}
  </section>;
}

function RecordedCustomerDetection({ view, onViewChange, active }: { view: MapView; onViewChange: (view: MapView) => void; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => { if (!active) video.current?.pause(); }, [active]);

  useEffect(() => {
    const player = video.current;
    if (!player?.requestVideoFrameCallback) return;
    let frame: number;
    const update: VideoFrameRequestCallback = (_now, metadata) => {
      setTime(metadata.mediaTime);
      frame = player.requestVideoFrameCallback(update);
    };
    frame = player.requestVideoFrameCallback(update);
    return () => player.cancelVideoFrameCallback(frame);
  }, []);

  const index = recordingFrameIndex(time);
  const sample = recording.frames[index];
  const visible = error ? [] : sample.detections;
  const history = recording.frames.slice(0, index + 1);
  const recent = history.filter(frame => frame.time >= time - 6);

  return <>
    <div className={styles.content}>
      <div className={styles.cameraPanel}>
        <div className={styles.subheading}><h3><Video size={16} aria-hidden="true" /> Camera 01</h3><span>Customer · Basket B / A</span></div>
        <div className={styles.camera}>
          <video ref={video} width={recording.width} height={recording.height} controls muted playsInline loop preload="metadata"
            poster={recording.posterUrl} aria-label="คลิปจริงพร้อมกรอบ YOLO: คนแรก Basket B คนที่สอง Basket A"
            onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
            onSeeked={event => setTime(event.currentTarget.currentTime)} onError={() => setError(true)}>
            <source src={recording.videoUrl} type="video/webm" />
            เบราว์เซอร์นี้ไม่รองรับวิดีโอ
          </video>
        </div>
        {error && <p className={styles.error} role="alert">เปิดคลิปไม่ได้ กรุณาโหลดหน้าใหม่หรือใช้เบราว์เซอร์ที่รองรับ WebM</p>}
        <div className={styles.videoFooter}><span><ScanLine size={14} aria-hidden="true" /> Class: Customer</span><span>{clock(time)} / {clock(recording.duration)}</span></div>
      </div>
      <div className={styles.mapPanel}>
        <div className={styles.subheading}><h3><MapPin size={16} aria-hidden="true" /> Customer map</h3>
          <div className={styles.toggle} role="group" aria-label="รูปแบบแผนที่ลูกค้า">
            <button type="button" aria-pressed={view === "points"} onClick={() => onViewChange("points")}>จุด</button>
            <button type="button" aria-pressed={view === "heatmap"} onClick={() => onViewChange("heatmap")}>Heatmap</button>
          </div>
        </div>
        <svg className={styles.map} viewBox="0 0 560 390" role="img" aria-label={`${view === "points" ? "แผนที่จุดและเส้นทาง" : "Heatmap"} Customer จากคลิป ณ วินาที ${Math.floor(time)}`}>
          <defs>
            <pattern id="customer-map-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="var(--c-line)" strokeWidth=".7" /></pattern>
            <radialGradient id="customer-heat"><stop offset="0" stopColor="#ff9548" stopOpacity=".28" /><stop offset=".5" stopColor="#e8c64e" stopOpacity=".14" /><stop offset="1" stopColor="#98d596" stopOpacity="0" /></radialGradient>
          </defs>
          <rect x="14" y="14" width="532" height="362" rx="16" fill="var(--c-bg)" stroke="var(--c-line)" />
          <rect x="16" y="16" width="528" height="358" rx="16" fill="url(#customer-map-grid)" />
          {recording.shelves.map(shelf => {
            const polygon = shelf.polygon.map(([x, y]) => mapPoint({ x, y }));
            const center = polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length }), { x: 0, y: 0 });
            return <g key={shelf.id}>
              <polygon points={polygon.map(point => `${point.x},${point.y}`).join(" ")} fill="var(--c-surface2)" stroke="var(--c-line)" />
              <text x={center.x} y={center.y + 4} textAnchor="middle" fill="var(--c-ink)" fontSize="12" fontWeight="600">{shelf.label}</text>
            </g>;
          })}
          {!error && recording.baskets.map(basket => <g key={basket.basketId}>
            {view === "heatmap" ? history.filter((_, i) => i % 5 === 0).map(frame => {
              const point = frame.detections.find(d => d.basketId === basket.basketId)?.mapPoint;
              if (!point) return null;
              const mapped = mapPoint(point);
              return <circle key={frame.time} cx={mapped.x} cy={mapped.y} r="26" fill="url(#customer-heat)" />;
            }) : trackSegments(recent, basket.basketId).map((segment, i) => <polyline key={i} points={segment.map(point => { const mapped = mapPoint(point); return `${mapped.x},${mapped.y}`; }).join(" ")} stroke={basket.color === "#c9f56b" ? "#6b9833" : "#2684b8"} strokeWidth="2" strokeDasharray="4 5" opacity=".7" fill="none" />)}
          </g>)}
          {visible.map(detection => {
            if (!detection.mapPoint) return null;
            const point = mapPoint(detection.mapPoint);
            const basket = recording.baskets.find(b => b.basketId === detection.basketId)!;
            return <g key={detection.basketId}>
              <circle cx={point.x} cy={point.y} r="13" fill={basket.color} opacity=".25" />
              <circle cx={point.x} cy={point.y} r="6" fill={basket.color} stroke="var(--c-ink)" strokeWidth="1.5" />
              <rect x={point.x - 17} y={point.y - 31} width="34" height="18" rx="5" fill="var(--c-surface)" stroke="var(--c-line)" />
              <text x={point.x} y={point.y - 18} textAnchor="middle" fontSize="10" fill="var(--c-ink)" fontWeight="700">{basket.basketId}</text>
            </g>;
          })}
        </svg>
        <div className={styles.legend}>{recording.baskets.map(basket => <span key={basket.basketId}><i style={{ backgroundColor: basket.color }} />Basket {basket.basketId} · คนที่ {basket.order}</span>)}</div>
      </div>
    </div>
    <footer className={styles.footer}><span><Users size={15} aria-hidden="true" /> {error ? "—" : visible.length} Customers</span><span>ปรับมุมกล้อง · พิกัดประมาณจากภาพ</span></footer>
    <details className={styles.calibration}>
      <summary>การปรับมุมกล้องและ Basket A/B</summary>
      <p>ฉายตำแหน่งเท้าลงผังด้วยจุดอ้างอิงบนพื้น 4 จุด และชดเชยกล้องเคลื่อน พิกัดประมาณจากภาพ ยังไม่มีสเกลระยะจริง</p>
      <p>กำหนดคนแรกเป็น Basket B และคนที่สองเป็น Basket A ตามคลิป ไม่ใช่การระบุตะกร้าด้วย BLE</p>
    </details>
  </>;
}
