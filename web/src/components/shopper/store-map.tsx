"use client";

import { MapPin, Radio } from "lucide-react";
import type { BasketId, PresenceSnapshot, StoreLayout } from "@/lib/api/types";
import { DEFAULT_STORE_LAYOUT, shelfZone } from "@/lib/store-layout";
import { StoreMapCanvas } from "@/components/store-map/store-map-canvas";
import styles from "./store-map.module.css";

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

export function StoreMap({ presence, layout, basketId }: { presence: PresenceSnapshot | null; layout: StoreLayout | null; basketId: BasketId }) {
  const plan = layout ?? DEFAULT_STORE_LAYOUT;
  const mine = presence?.baskets.find((basket) => basket.basketId === basketId) ?? null;
  const online = new Map(presence?.shelves.map((shelf) => [shelf.shelfId, shelf.online]) ?? []);
  const mineLabel = mine?.zone ? (shelfZone(plan, mine.zone)?.label ?? mine.zone) : null;
  const position = presence?.positioning?.positions[basketId] ?? null;
  // Shelves on the plan first, then any shelf the hardware reports that the plan does not draw yet.
  const planShelfIds = plan.zones.filter((zone) => zone.kind === "shelf" && zone.shelfId).map((zone) => zone.shelfId as string);
  const shelfIds = [...planShelfIds, ...(presence?.shelves.map((shelf) => shelf.shelfId).filter((id) => !planShelfIds.includes(id)) ?? [])];

  const summary = !presence ? "กำลังรอข้อมูลตำแหน่งจากชั้นวาง"
    : mineLabel ? `ตะกร้า ${basketId} อยู่ใกล้ ${mineLabel} (${mine?.zone})`
      : `ตะกร้า ${basketId} ยังไม่อยู่ใกล้ชั้นวางใด`;

  return (
    <section className={styles.card} aria-labelledby="store-map-heading">
      <div className={styles.heading}>
        <span className={styles.iconTile}><MapPin size={22} aria-hidden="true" /></span>
        <div><p className={styles.eyebrow}>STORE MAP</p><h2 id="store-map-heading">แผนผังร้าน</h2></div>
        {mine?.source && <span className={mine.source === "PICK" ? styles.pickBadge : styles.rssiBadge}>
          {mine.source === "PICK" ? "ยืนยันจากการหยิบ" : "จากสัญญาณ BLE"}
        </span>}
      </div>

      <StoreMapCanvas layout={plan} presence={presence} basketId={basketId} label={summary} />

      <p className={styles.summary} role="status" aria-live="polite">
        <MapPin size={15} aria-hidden="true" />
        <span>{mineLabel ? <>คุณอยู่ใกล้ <strong>{mineLabel}</strong></> : position ? "ตำแหน่งโดยประมาณของคุณ" : summary}</span>
        {mine?.since && mine.zone && <span className={styles.since}>ตั้งแต่ {time(mine.since)}</span>}
      </p>
      {position && <p className={styles.positionNote}>
        จุดบนผังคำนวณจาก ESP32 {position.anchors} ตัว · คลาดเคลื่อนได้ประมาณ ±{position.errorM.toFixed(1)} ม. (วงกลมประ)
      </p>}

      {presence && shelfIds.length > 0 && (
        <ul className={styles.shelfList} aria-label="สัญญาณจากชั้นวาง">
          {shelfIds.map((shelfId) => {
            const rssi = mine?.rssi[shelfId] ?? null;
            const isOnline = online.get(shelfId) ?? false;
            return (
              <li key={shelfId} className={mine?.zone === shelfId ? styles.rowHere : ""}>
                <span className={isOnline ? styles.dotOnlineInline : styles.dotOfflineInline} aria-hidden="true" />
                <span className={styles.rowName}>{shelfZone(plan, shelfId)?.label ?? shelfId} <small>{shelfId}</small></span>
                <span className={styles.rowValue}>
                  {!isOnline ? "ออฟไลน์" : rssi === null ? "ไม่พบตะกร้า" : <><Radio size={12} aria-hidden="true" /> {rssi} dBm</>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.footnote}>
        ตำแหน่งระดับชั้นวางจากสัญญาณ BLE ของตะกร้า ไม่ใช่พิกัดจริง
        {presence && ` · เข้าโซนที่ ${presence.thresholds.enterDbm} dBm`}
      </p>
    </section>
  );
}
