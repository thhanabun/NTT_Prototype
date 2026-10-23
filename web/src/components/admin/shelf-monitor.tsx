import { Signal } from "lucide-react";
import type { Shelf } from "@/lib/api/types";
import { formatTime } from "./case-details";
import styles from "./admin.module.css";

export function ShelfMonitor({ shelf }: { shelf?: Shelf }) {
  const device = shelf?.device;
  const status = device?.status || "UNKNOWN";
  return <section className={styles.card} aria-labelledby="proximity-heading">
    <div className={styles.sectionHeading}><div><h2 id="proximity-heading">สัญญาณชั้นวาง</h2></div><span className={`${styles.badge} ${status === "ONLINE" ? styles.green : styles.amber}`} data-testid="device-status">{status}</span></div>
    <p className={styles.muted}><Signal size={14} aria-hidden="true" /> ความใกล้ตะกร้า · RSSI</p>
    {(["A", "B", "HV01"] as const).map(id => {
      const reading = device?.rssi[id];
      return <div className={styles.signalRow} key={id}><span>{id === "HV01" ? "HV-001" : `Basket ${id}`}</span><div className={styles.signalTrack}><span style={{ width: reading === null || reading === undefined ? "0%" : `${Math.max(3, Math.min(100, (reading + 100) * 1.5))}%` }} /></div><strong data-testid={`device-rssi-${id}`}>{reading ?? "—"}{reading !== null && reading !== undefined ? " dBm" : ""}</strong></div>;
    })}
    <div className={styles.hardwareLanes}>{[["LANE-1", "LANE-COKE", "Coke · GPIO 26"], ["LANE-2", "LANE-WATER", "Water · GPIO 27"]].map(([id, alias, label]) => {
      const lane = device?.lanes.find(lane => lane.laneId === id || lane.laneId === alias);
      return <div key={id}><span>{label}</span><strong data-testid={`device-lane-${id}`}>{lane ? lane.present ? "PRESENT" : "EMPTY" : "UNKNOWN"}</strong></div>;
    })}</div>
    <dl className={styles.hardwareMetrics}><div><dt>Uptime</dt><dd data-testid="device-uptime">{device?.uptimeMs !== null && device?.uptimeMs !== undefined ? `${Math.floor(device.uptimeMs / 1000)} s` : "—"}</dd></div><div><dt>Queue</dt><dd>{device?.queueDepth ?? "—"}</dd></div><div><dt>Dropped</dt><dd>{device?.droppedEvents ?? "—"}</dd></div></dl>
    <p className={styles.footnote}>สัญญาณล่าสุด: <time data-testid="device-last-seen" dateTime={device?.lastSeenAt || undefined}>{formatTime(device?.lastSeenAt)}</time><br />{status === "UNKNOWN" ? "ยังไม่ได้รับสัญญาณอุปกรณ์" : status === "OFFLINE" ? "ขาดการเชื่อมต่อ · ซ่อนค่าที่หมดอายุ" : "เชื่อมต่อแล้ว"}<br />เหตุการณ์ล่าสุด: {formatTime(shelf?.lastSeenAt)} · FSM: {shelf?.fsmState || "—"}</p>
  </section>;
}
