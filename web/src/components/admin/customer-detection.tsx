"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, ScanLine, Users, Video } from "lucide-react";
import { customerTrackingDemo as demo, demoCameraBox, demoPosition } from "@/lib/customer-tracking-demo";
import styles from "./customer-detection.module.css";

const clock = (value: number) => `00:${String(Math.floor(value)).padStart(2, "0")}`;
const mapPoint = ({ x, y }: { x: number; y: number }) => ({ x: 40 + x * 480, y: 28 + y * 320 });

export function CustomerDetection() {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [view, setView] = useState<"points" | "heatmap">("points");
  const [error, setError] = useState(false);

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

  const tracks = demo.tracks.map(track => ({ ...track, position: demoPosition(track.points, time) }));

  return <section className={styles.panel} aria-labelledby="customer-detection-heading">
    <header className={styles.heading}>
      <div><p>STORE VISION</p><h2 id="customer-detection-heading">Object Detection</h2></div>
      <span className={styles.mockBadge}>MOCK · รอคลิปจริง</span>
    </header>
    <div className={styles.content}>
      <div className={styles.cameraPanel}>
        <div className={styles.subheading}><h3><Video size={16} aria-hidden="true" /> Camera 01</h3><span>Customer tracking</span></div>
        <div className={styles.camera}>
          <video ref={video} width={demo.width} height={demo.height} controls muted playsInline loop preload="metadata"
            poster="/demos/customer-walk.jpg" aria-label="วิดีโอจำลองการเดินของ Customer 3 คน"
            onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
            onSeeked={event => setTime(event.currentTarget.currentTime)} onError={() => setError(true)}>
            <source src="/demos/customer-walk.webm" type="video/webm" />
            เบราว์เซอร์นี้ไม่รองรับวิดีโอ
          </video>
          {!error && <svg className={styles.overlay} viewBox={`0 0 ${demo.width} ${demo.height}`} aria-hidden="true">
            {tracks.map(track => {
              const box = demoCameraBox(track.position);
              return <g key={track.id} stroke={track.color}>
                <rect {...box} rx="4" fill="none" strokeWidth="2" />
                <rect x={box.x} y={box.y - 23} width="132" height="22" rx="3" fill={track.color} stroke="none" />
                <text x={box.x + 7} y={box.y - 8} fill="#13251f" stroke="none" fontSize="13" fontWeight="700">Customer #{track.id}</text>
                <circle cx={box.x + box.width / 2} cy={box.y + box.height} r="4" fill={track.color} />
              </g>;
            })}
          </svg>}
        </div>
        {error && <p className={styles.error} role="alert">เปิดวิดีโอจำลองไม่ได้ กรุณาโหลดหน้าใหม่หรือใช้เบราว์เซอร์ที่รองรับ WebM</p>}
        <div className={styles.videoFooter}><span><ScanLine size={14} aria-hidden="true" /> Class: Customer</span><span>{clock(time)} / {clock(demo.duration)}</span></div>
      </div>
      <div className={styles.mapPanel}>
        <div className={styles.subheading}><h3><MapPin size={16} aria-hidden="true" /> Customer map</h3>
          <div className={styles.toggle} role="group" aria-label="รูปแบบแผนที่ลูกค้า">
            <button type="button" aria-pressed={view === "points"} onClick={() => setView("points")}>จุด</button>
            <button type="button" aria-pressed={view === "heatmap"} onClick={() => setView("heatmap")}>Heatmap</button>
          </div>
        </div>
        <svg className={styles.map} viewBox="0 0 560 390" role="img" aria-label={`${view === "points" ? "แผนที่จุดและเส้นทาง" : "Heatmap"} Customer จำลอง ณ วินาที ${Math.floor(time)}`}>
          <defs>
            <pattern id="customer-map-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#dde5db" strokeWidth=".7" /></pattern>
            <radialGradient id="customer-heat"><stop offset="0" stopColor="#ff9548" stopOpacity=".28" /><stop offset=".5" stopColor="#e8c64e" stopOpacity=".14" /><stop offset="1" stopColor="#98d596" stopOpacity="0" /></radialGradient>
          </defs>
          <rect x="14" y="14" width="532" height="362" rx="16" fill="#f6f8f2" stroke="#d7e2d4" />
          <rect x="16" y="16" width="528" height="358" rx="16" fill="url(#customer-map-grid)" />
          {[0.19, 0.50, 0.81].map((x, index) => <g key={index}>
            <rect x={40 + (x - .105) * 480} y="92" width="101" height="90" rx="8" fill="#dfe9da" stroke="#b8cdb1" />
            <path d={`M ${40 + (x - .105) * 480 + 10} 122 h 81 M ${40 + (x - .105) * 480 + 10} 152 h 81`} stroke="#bdd0b6" />
            <text x={40 + x * 480} y="144" textAnchor="middle" fill="#4b6950" fontSize="14" fontWeight="600">Shelf {index + 1}</text>
          </g>)}
          <text x="280" y="364" textAnchor="middle" fill="#81917a" fontSize="11" letterSpacing="2">ENTRANCE / EXIT</text>
          {!error && tracks.map(track => {
            const point = mapPoint(track.position);
            const past = Array.from({ length: Math.floor(time * 2) + 1 }, (_, i) => mapPoint(demoPosition(track.points, i / 2)));
            return <g key={track.id}>
              {view === "heatmap" ? past.map((sample, index) => <circle key={index} cx={sample.x} cy={sample.y} r="29" fill="url(#customer-heat)" />) : <polyline points={past.slice(-16).map(sample => `${sample.x},${sample.y}`).join(" ")} stroke={track.color === "#c9f56b" ? "#6b9833" : track.color === "#71c9ff" ? "#2684b8" : "#c77c38"} strokeWidth="2" strokeDasharray="4 5" opacity=".65" fill="none" />}
              <circle cx={point.x} cy={point.y} r="13" fill={track.color} opacity=".25" />
              <circle cx={point.x} cy={point.y} r="6" fill={track.color} stroke="#294c3c" strokeWidth="1.5" />
              <rect x={point.x - 17} y={point.y - 31} width="34" height="18" rx="5" fill="#fff" stroke="#dde5db" />
              <text x={point.x} y={point.y - 18} textAnchor="middle" fontSize="10" fill="#325346" fontWeight="700">{track.id}</text>
            </g>;
          })}
        </svg>
        <div className={styles.legend}>{tracks.map(track => <span key={track.id}><i style={{ backgroundColor: track.color }} />Customer #{track.id}</span>)}</div>
      </div>
    </div>
    <footer className={styles.footer}><span><Users size={15} aria-hidden="true" /> {error ? "—" : tracks.length} Customers <small>จำลอง</small></span><span>ผังจำลอง · ยังไม่ calibrate กล้อง</span></footer>
  </section>;
}
