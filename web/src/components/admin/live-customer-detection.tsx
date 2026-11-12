"use client";

import { useCallback, useEffect, useState } from "react";
import type { MapView } from "@/lib/admin-commands";
import { getPresence, postTracks, setPresenceLink } from "@/lib/api/client";
import type { BasketId, PresenceView } from "@/lib/api/types";
import { useVisionEvent } from "@/lib/api/vision-stream";
import { useStoreMap } from "@/lib/use-store-map";
import { CameraFeed, type CameraFrame, type CameraSource } from "./camera-feed";
import { StoreMapView } from "./store-map-view";
import styles from "./customer-detection.module.css";

const MAX_CAMERAS = 4; // The local YOLO service keeps at most 4 live tracker sessions.
const CAMERA_COLOURS = ["#f47b3c", "#6f9fe8", "#b58be8", "#5fbf9f"];
const tagColour = (tag: BasketId | null) => tag === "A" ? "#9fd64b" : tag === "B" ? "#4fb3f0" : "#e8a45e";
type Camera = { cameraId: string; source: CameraSource; colour: string };
type Sample = { time: number; points: { shopperId: string; x: number; y: number; tag: BasketId | null }[] };

/** Several cameras (webcams, phones, test videos) on one store map. People become shoppers on the server and are linked to baskets. */
export function LiveCustomerDetection({ view, onViewChange, active }: { view: MapView; onViewChange: (view: MapView) => void; active: boolean }) {
  const { map, error: mapError } = useStoreMap();
  const [presence, setPresence] = useState<PresenceView | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("environment");
  const [name, setName] = useState("CAM-01");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const receive = useCallback((value: PresenceView) => {
    setPresence(value);
    setHistory(current => [...current.slice(-599), { time: Date.parse(value.at), points: value.shoppers.map(({ shopperId, x, y, tag }) => ({ shopperId, x, y, tag })) }]);
  }, []);
  useEffect(() => { void getPresence().then(receive).catch(() => {}); }, [receive]);
  useVisionEvent<PresenceView>("presence", receive);
  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices?.().then(list => setDevices(list.filter(item => item.kind === "videoinput" && item.deviceId))).catch(() => {});
  }, []);

  const sendFrame = useCallback((frame: CameraFrame) => {
    void postTracks({ ...frame, tracks: frame.tracks.map(({ trackId, confidence, box, floor, occluded }) => ({ trackId, confidence, box, floor, occluded })) })
      .then(() => setError(""))
      .catch(cause => setError("ส่งตำแหน่งไปเซิร์ฟเวอร์ไม่สำเร็จ: " + (cause instanceof Error ? cause.message : "")));
  }, []);
  const shopperFor = useCallback((cameraId: string, trackId: number) =>
    presence?.shoppers.find(s => s.tracks.some(t => t.cameraId === cameraId && t.trackId === trackId)), [presence]);

  function addCamera(useFile: boolean) {
    const cameraId = name.trim().toUpperCase();
    if (!/^CAM-[A-Z0-9-]{1,32}$/.test(cameraId)) { setError("ชื่อกล้องต้องขึ้นต้นด้วย CAM- เช่น CAM-01"); return; }
    if (cameras.some(camera => camera.cameraId === cameraId)) { setError(`มี ${cameraId} อยู่แล้ว`); return; }
    if (cameras.length >= MAX_CAMERAS) { setError(`เปิดได้สูงสุด ${MAX_CAMERAS} กล้องพร้อมกัน`); return; }
    if (useFile && !file) { setError("เลือกไฟล์วิดีโอก่อน"); return; }
    const label = device === "environment" ? "กล้องหลัง/หลัก" : device === "user" ? "กล้องหน้า" : devices.find(d => d.deviceId === device)?.label || "กล้อง";
    const source: CameraSource = useFile ? { kind: "file", file: file! } : { kind: "device", deviceId: device, label };
    const colour = CAMERA_COLOURS.find(c => !cameras.some(camera => camera.colour === c)) ?? CAMERA_COLOURS[0];
    setCameras(current => [...current, { cameraId, source, colour }]);
    setError("");
    const next = Array.from({ length: 9 }, (_, i) => `CAM-${String(i + 1).padStart(2, "0")}`).find(id => id !== cameraId && !cameras.some(c => c.cameraId === id));
    if (next) setName(next);
  }

  async function link(shopperId: string, tag: string) {
    try { receive(await setPresenceLink(shopperId, tag === "A" || tag === "B" ? tag : null)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ผูกตะกร้าไม่สำเร็จ"); }
  }

  if (!map) return <p className={styles.calibration}>{mapError || "กำลังโหลดแผนที่ร้าน…"}</p>;
  const saved = Object.keys(map.cameras);
  const unit = map.width / 100;
  const recent = history.filter(sample => sample.time >= (history.at(-1)?.time ?? 0) - 6000);
  const mappedCount = cameras.filter(c => map.cameras[c.cameraId]).length;
  return <>
    <div className={styles.cameraControls}>
      <label>ชื่อกล้อง <input list="saved-cameras" value={name} maxLength={36} onChange={e => setName(e.target.value)} /></label>
      <datalist id="saved-cameras">{saved.map(id => <option key={id} value={id} />)}</datalist>
      <label>แหล่งภาพ <select value={device} onChange={e => setDevice(e.target.value)}>
        <option value="environment">กล้องหลัง / กล้องหลัก</option><option value="user">กล้องหน้า</option>
        {devices.map((item, i) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Camera ${i + 1}`}</option>)}
      </select></label>
      <button type="button" disabled={!active} onClick={() => addCamera(false)}>+ เพิ่มกล้อง</button>
      <label>วิดีโอทดสอบ <input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <button type="button" disabled={!active || !file} onClick={() => addCamera(true)}>+ เพิ่มวิดีโอ</button>
    </div>
    <p className={styles.calibration}>ขั้นตอน: 1) วาด Shelf/พื้นที่ในแท็บ “แผนที่ร้าน” 2) เพิ่มกล้องหรือวิดีโอ 3) กด “จับคู่กล้องกับแผนที่” แล้วคลิกมุมของ Shelf ที่เห็นในภาพ · กล้องที่เคยจับคู่แล้วใช้ชื่อเดิมได้เลย
      {cameras.length > 0 && ` · จับคู่แล้ว ${mappedCount}/${cameras.length} กล้อง`}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.content}>
      <div className={styles.feeds}>
        {cameras.length ? cameras.map(camera => <CameraFeed key={camera.cameraId} {...camera} map={map} onFrame={sendFrame}
          labelFor={trackId => { const s = shopperFor(camera.cameraId, trackId); return s ? (s.tag ? `Basket ${s.tag}` : s.shopperId) : null; }}
          onRemove={() => setCameras(current => current.filter(c => c.cameraId !== camera.cameraId))} />)
          : <p className={styles.cameraPlaceholderInline}>ยังไม่มีกล้อง เพิ่มกล้องหรือวิดีโอทดสอบด้านบน</p>}
      </div>
      <div className={styles.mapPanel}>
        <div className={styles.subheading}><h3>แผนที่ร้าน · ลูกค้า</h3><div className={styles.toggle} role="group" aria-label="รูปแบบแผนที่">
          <button type="button" aria-pressed={view === "points"} onClick={() => onViewChange("points")}>จุด</button>
          <button type="button" aria-pressed={view === "heatmap"} onClick={() => onViewChange("heatmap")}>Heatmap</button>
        </div></div>
        <StoreMapView map={map} className={styles.map} label={`แผนที่ร้าน มีลูกค้า ${presence?.shoppers.length ?? 0} คน`}>
          <defs><radialGradient id="presence-heat"><stop offset="0" stopColor="#ff9548" stopOpacity=".25" /><stop offset="1" stopColor="#98d596" stopOpacity="0" /></radialGradient></defs>
          {view === "heatmap" ? history.filter((_, i) => i % 2 === 0).flatMap((sample, i) => sample.points.map(p => <circle key={`${i}-${p.shopperId}`} cx={p.x} cy={p.y} r={unit * 5} fill="url(#presence-heat)" />))
            : recent.flatMap((sample, i) => sample.points.map(p => <circle key={`${i}-${p.shopperId}`} cx={p.x} cy={p.y} r={unit * .5} fill={tagColour(p.tag)} opacity={.45} />))}
          {presence?.shoppers.map(s => <g key={s.shopperId}>
            <circle cx={s.x} cy={s.y} r={unit * 1.4} fill={tagColour(s.tag)} stroke="var(--c-ink)" strokeWidth={unit * .25} />
            <text x={s.x} y={s.y - unit * 2.4} textAnchor="middle" fontSize={unit * 2.6} fontWeight={700} fill="var(--c-ink)">{s.tag ? `Basket ${s.tag}` : "Anonymous"}</text>
          </g>)}
        </StoreMapView>
        <div className={styles.legend}><span><i style={{ background: tagColour("A") }} />Basket A</span><span><i style={{ background: tagColour("B") }} />Basket B</span><span><i style={{ background: tagColour(null) }} />Anonymous (ไม่มีตะกร้า)</span></div>
        {presence && presence.shoppers.length > 0 && <ul className={styles.shopperList} aria-label="ลูกค้าในร้าน">
          {presence.shoppers.map(s => <li key={s.shopperId}>
            <span><b>{s.shopperId}</b> · {s.zone ?? "ทางเดิน"} · {s.cameras.join(", ")}{s.source === "TEST_VIDEO" ? " · TEST_VIDEO" : ""}</span>
            <label>ตะกร้า <select value={s.tag ?? ""} onChange={e => void link(s.shopperId, e.target.value)}>
              <option value="">ไม่มี (Anonymous)</option><option value="A">Basket A</option><option value="B">Basket B</option>
            </select></label>
            <small>{s.linkedBy === "STAFF" ? "ผูกโดยพนักงาน" : s.linkedBy === "PRESENCE" ? "ผูกอัตโนมัติจาก BLE" : ""}</small>
          </li>)}
        </ul>}
        <p className={styles.calibration}>ผูกตะกร้าอัตโนมัติเมื่อคนเดียวยืนที่ Shelf เดียวกับแท็ก BLE ≥ 3 วินาที · สองคนที่ Shelf เดียวกันจะยังไม่เดา · พนักงานแก้ได้เสมอ{map.metresPerUnit === null ? " · สเกลยังเป็นค่าสมมติ ระยะเป็นค่าประมาณ" : ""}</p>
      </div>
    </div>
  </>;
}
