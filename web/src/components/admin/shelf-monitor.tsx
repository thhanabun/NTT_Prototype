"use client";

import { useState } from "react";
import { Signal } from "lucide-react";
import type { BleTagLocation, Shelf } from "@/lib/api/types";
import { SHELF_PRODUCTS } from "@/lib/shelves";
import { formatTime } from "./case-details";
import styles from "./admin.module.css";

const bleStatusLabel: Record<BleTagLocation["status"], string> = {
  UNCALIBRATED: "ยังไม่ปรับเทียบ",
  TRACKING: "กำลังติดตาม",
  OUTSIDE: "อยู่นอกพื้นที่",
  PARTIAL: "ข้อมูลไม่ครบ",
  STALE: "ไม่มีสัญญาณสด",
  WAITING: "รอยืนยันเข้า",
};
const bleStatusClass: Record<BleTagLocation["status"], string> = {
  UNCALIBRATED: styles.neutral,
  TRACKING: styles.green,
  OUTSIDE: styles.neutral,
  PARTIAL: styles.amber,
  STALE: styles.amber,
  WAITING: styles.blue,
};
const presenceLabel: Record<BleTagLocation["presence"], string> = {
  UNCONFIGURED: "ยังไม่ตั้งเกณฑ์",
  UNKNOWN: "ยังไม่ทราบ",
  INSIDE: "เข้าเขต",
  OUTSIDE: "ออกเขต",
  PARTIAL: "ข้อมูลไม่ครบ",
};

export function ShelfMonitor({ shelves, bleLocations }: { shelves: Shelf[]; bleLocations: BleTagLocation[] }) {
  const [selectedId, setSelectedId] = useState("SHELF-01");
  const shelf = shelves.find(shelf => shelf.shelfId === selectedId) ?? shelves[0];
  const device = shelf?.device;
  const product = SHELF_PRODUCTS.find(product => product.shelfId === shelf?.shelfId);
  const status = device?.status || "UNKNOWN";
  return <section className={styles.card} aria-labelledby="proximity-heading">
    <div className={styles.sectionHeading}><h2 id="proximity-heading">ชั้นวาง</h2><span className={styles.smallLabel}>เปิดใช้งาน {shelves.filter(shelf => shelf.enabled).length} / {shelves.length}</span></div>
    <div className={styles.shelfPicker} role="group" aria-label="เลือกชั้นวาง">
      {shelves.map(item => <button type="button" key={item.shelfId} disabled={!item.enabled} aria-pressed={selectedId === item.shelfId} onClick={() => setSelectedId(item.shelfId)}>
        <strong>{item.label}</strong><small>{item.shelfId}</small>
        <span className={`${styles.badge} ${!item.enabled ? styles.neutral : item.device?.status === "ONLINE" ? styles.green : styles.amber}`}>{!item.enabled ? "ยังไม่เปิดใช้" : item.device?.status === "ONLINE" ? "ออนไลน์" : item.device?.status === "OFFLINE" ? "ออฟไลน์" : "รอสัญญาณ"}</span>
      </button>)}
    </div>
    <div className={styles.shelfDetailHeading}><h3>{shelf?.label}</h3><span className={`${styles.badge} ${status === "ONLINE" ? styles.green : styles.amber}`} data-testid="device-status">{status}</span></div>
    <p className={styles.muted}>{product?.name}</p>
    <p className={styles.muted}><Signal size={14} aria-hidden="true" /> ความใกล้ตะกร้า · RSSI</p>
    {(["A", "B", "HV01"] as const).map(id => {
      const reading = device?.rssi[id];
      return <div className={styles.signalRow} key={id}><span>{id === "HV01" ? "HV-001" : `Basket ${id}`}</span><div className={styles.signalTrack}><span style={{ width: reading === null || reading === undefined ? "0%" : `${Math.max(3, Math.min(100, (reading + 100) * 1.5))}%` }} /></div><strong data-testid={`device-rssi-${id}`}>{reading ?? "—"}{reading !== null && reading !== undefined ? " dBm" : ""}</strong></div>;
    })}
    <div className={styles.hardwareLanes}>{[["LANE-1", "LANE-COKE", "ช่อง 1"], ["LANE-2", "LANE-WATER", "ช่อง 2"]].map(([id, alias, label]) => {
      const lane = device?.lanes.find(lane => lane.laneId === id || lane.laneId === alias);
      return <div key={id}><span>{label}</span><strong data-testid={`device-lane-${id}`}>{lane ? lane.present ? "PRESENT" : "EMPTY" : "UNKNOWN"}</strong></div>;
    })}</div>
    <section className={styles.bleLocationSection} aria-labelledby="ble-location-heading">
      <div className={styles.sectionHeading}><h3 id="ble-location-heading">ตำแหน่งแท็ก BLE</h3><span className={styles.smallLabel}>ตัวรับ 3 จุด</span></div>
      <div className={styles.bleLocationList}>
        {bleLocations.map(location => <article className={styles.bleLocationRow} key={location.tagId} data-testid={`ble-location-${location.tagId}`}>
          <div><strong>{location.tagId === "HV01" ? "HV-001" : `Basket ${location.tagId}`}</strong><span className={`${styles.badge} ${bleStatusClass[location.status]}`}>{bleStatusLabel[location.status]}</span></div>
          <strong data-testid={`ble-position-${location.tagId}`}>{location.x !== null && location.y !== null ? `x ${location.x.toFixed(1)} · y ${location.y.toFixed(1)} m` : "—"}</strong>
          <small>{location.zone ? `โซน ${location.zone} · ` : ""}{presenceLabel[location.presence]} · ใกล้ {location.nearestReaderId || "—"}</small>
          <small>RSSI · {(["SHELF-01", "SHELF-02", "SHELF-03"] as const).map(id => `${id.replace("SHELF-", "")} ${location.rssi[id] ?? "—"}`).join(" / ")} dBm</small>
        </article>)}
        {!bleLocations.length && <p className={styles.muted}>รอข้อมูลจากตัวรับทั้งสามจุด</p>}
      </div>
    </section>
    <dl className={styles.hardwareMetrics}><div><dt>Uptime</dt><dd data-testid="device-uptime">{device?.uptimeMs !== null && device?.uptimeMs !== undefined ? `${Math.floor(device.uptimeMs / 1000)} s` : "—"}</dd></div><div><dt>Queue</dt><dd>{device?.queueDepth ?? "—"}</dd></div><div><dt>Dropped</dt><dd>{device?.droppedEvents ?? "—"}</dd></div></dl>
    <p className={styles.footnote}>สัญญาณล่าสุด: <time data-testid="device-last-seen" dateTime={device?.lastSeenAt || undefined}>{formatTime(device?.lastSeenAt)}</time><br />{status === "UNKNOWN" ? "ยังไม่ได้รับสัญญาณอุปกรณ์" : status === "OFFLINE" ? "ขาดการเชื่อมต่อ · ซ่อนค่าที่หมดอายุ" : "เชื่อมต่อแล้ว"}<br />เหตุการณ์ล่าสุด: {formatTime(shelf?.lastSeenAt)} · FSM: {shelf?.fsmState || "—"}</p>
  </section>;
}
