"use client";

import { MapPin, Radio } from "lucide-react";
import type { BasketId, PresenceSnapshot } from "@/lib/api/types";
import styles from "./store-map.module.css";

// Floor plan in SVG units (viewBox 360 x 250). Edit here to match the physical store.
const SHELVES = [
  { shelfId: "SHELF-01", label: "เครื่องดื่ม", detail: "Coke · Water", x: 28, y: 30, w: 132, h: 32 },
  { shelfId: "SHELF-02", label: "ขนม", detail: "Snacks", x: 200, y: 30, w: 132, h: 32 },
  { shelfId: "SHELF-03", label: "โซนพิเศษ", detail: "High-value", x: 200, y: 122, w: 132, h: 32 },
] as const;
const CASHIER = { x: 28, y: 186, w: 112, h: 38 };

const shelfLayout = new Map<string, (typeof SHELVES)[number]>(SHELVES.map((shelf) => [shelf.shelfId, shelf]));

// The spot in front of a shelf where a basket near it is drawn.
function standPoint(shelfId: string, offset: number) {
  const shelf = shelfLayout.get(shelfId);
  if (!shelf) return null;
  return { x: shelf.x + shelf.w / 2 + offset, y: shelf.y + shelf.h + 24 };
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

export function StoreMap({ presence, basketId }: { presence: PresenceSnapshot | null; basketId: BasketId }) {
  const mine = presence?.baskets.find((basket) => basket.basketId === basketId) ?? null;
  const others = presence?.baskets.filter((basket) => basket.basketId !== basketId) ?? [];
  const online = new Map(presence?.shelves.map((shelf) => [shelf.shelfId, shelf.online]) ?? []);
  const mineLabel = mine?.zone ? (shelfLayout.get(mine.zone)?.label ?? mine.zone) : null;
  const sharedZone = (zone: string | null) => Boolean(zone && others.some((other) => other.zone === zone) && mine?.zone === zone);

  const minePoint = mine?.zone ? standPoint(mine.zone, sharedZone(mine.zone) ? -14 : 0) : null;
  const unknownShelves = presence?.shelves.filter((shelf) => !shelfLayout.has(shelf.shelfId)) ?? [];

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

      <svg className={styles.map} viewBox="0 0 360 250" role="img" aria-label={summary}>
        <rect className={styles.floor} x="8" y="8" width="344" height="234" rx="16" />
        <line className={styles.entrance} x1="232" y1="242" x2="312" y2="242" />
        <text className={styles.floorLabel} x="272" y="232" textAnchor="middle">ทางเข้า</text>

        <rect className={styles.cashier} x={CASHIER.x} y={CASHIER.y} width={CASHIER.w} height={CASHIER.h} rx="8" />
        <text className={styles.shelfLabel} x={CASHIER.x + CASHIER.w / 2} y={CASHIER.y + 24} textAnchor="middle">แคชเชียร์</text>

        {SHELVES.map((shelf) => {
          const isOnline = online.get(shelf.shelfId) ?? false;
          const isHere = mine?.zone === shelf.shelfId;
          return (
            <g key={shelf.shelfId} className={`${styles.shelf} ${isHere ? styles.shelfHere : ""} ${isOnline ? "" : styles.shelfOffline}`}>
              <rect x={shelf.x} y={shelf.y} width={shelf.w} height={shelf.h} rx="7" />
              <text className={styles.shelfLabel} x={shelf.x + 12} y={shelf.y + 20}>{shelf.label}</text>
              <text className={styles.shelfId} x={shelf.x + shelf.w - 22} y={shelf.y + 20} textAnchor="end">{shelf.shelfId.replace("SHELF-", "S")}</text>
              <circle className={isOnline ? styles.dotOnline : styles.dotOffline} cx={shelf.x + shelf.w - 10} cy={shelf.y + 16} r="4" />
            </g>
          );
        })}

        {others.map((other) => {
          const point = other.zone ? standPoint(other.zone, sharedZone(other.zone) ? 14 : 0) : null;
          if (!point) return null;
          return (
            <g key={other.basketId} className={styles.marker} style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
              <circle className={styles.otherPin} r="9" />
              <text className={styles.otherLetter} y="4" textAnchor="middle">{other.basketId}</text>
            </g>
          );
        })}

        {minePoint && (
          <g className={styles.marker} style={{ transform: `translate(${minePoint.x}px, ${minePoint.y}px)` }}>
            <circle className={styles.pulse} r="16" />
            <path className={styles.myPin} d="M0 8 C-9 -2 -11 -6 -11 -11 A11 11 0 1 1 11 -11 C11 -6 9 -2 0 8 Z" />
            <text className={styles.myLetter} y="-7" textAnchor="middle">{basketId}</text>
          </g>
        )}
      </svg>

      <p className={styles.summary} role="status" aria-live="polite">
        <MapPin size={15} aria-hidden="true" />
        <span>{mineLabel ? <>คุณอยู่ใกล้ <strong>{mineLabel}</strong></> : summary}</span>
        {mine?.since && mine.zone && <span className={styles.since}>ตั้งแต่ {time(mine.since)}</span>}
      </p>

      {presence && (
        <ul className={styles.shelfList} aria-label="สัญญาณจากชั้นวาง">
          {[...SHELVES.map((shelf) => shelf.shelfId), ...unknownShelves.map((shelf) => shelf.shelfId)].map((shelfId) => {
            const rssi = mine?.rssi[shelfId] ?? null;
            const isOnline = online.get(shelfId) ?? false;
            return (
              <li key={shelfId} className={mine?.zone === shelfId ? styles.rowHere : ""}>
                <span className={isOnline ? styles.dotOnlineInline : styles.dotOfflineInline} aria-hidden="true" />
                <span className={styles.rowName}>{shelfLayout.get(shelfId)?.label ?? shelfId} <small>{shelfId}</small></span>
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
