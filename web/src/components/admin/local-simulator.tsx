"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Send } from "lucide-react";
import { submitShelfEvent } from "@/lib/api/client";
import type { ShelfEventInput } from "@/lib/api/types";
import { SHELF_OPTIONS, getShelfProduct } from "@/lib/shelves";
import styles from "./admin.module.css";

const scenarios = [
  {id:"clear-a",label:"Clear pick → A",description:"Basket A มี RSSI ใกล้กว่าชัดเจน"},
  {id:"clear-b",label:"Clear pick → B",description:"Basket B มี RSSI ใกล้กว่าชัดเจน"},
  {id:"ambiguous",label:"Ambiguous pick",description:"ใกล้กันมาก ให้ Agent ประเมินก่อนส่งลูกค้าหรือพนักงาน"},
  {id:"tie",label:"Tied RSSI",description:"RSSI เท่ากัน ส่งให้พนักงานตรวจสอบ"},
  {id:"unknown",label:"Unknown zone",description:"ไม่มีหลักฐาน RSSI ยังระบุตะกร้าไม่ได้"},
  {id:"put-back",label:"Put back → A",description:"คืนสินค้าที่เลือกจาก Basket A"},
  {id:"duplicate",label:"Duplicate delivery",description:"ส่ง event ID เดิมอีกครั้ง cart ต้องไม่เพิ่มซ้ำ"},
] as const;
type Scenario = (typeof scenarios)[number]["id"];

export function LocalSimulator({ disabled, shelfId, run }: {
  disabled: boolean;
  shelfId: string;
  run: (action: () => Promise<string>) => Promise<void>;
}) {
  const [lane, setLane] = useState("LANE-1");
  const [selectedShelf, setSelectedShelf] = useState(shelfId);
  const last = useRef<ShelfEventInput | null>(null);
  const [hasLast, setHasLast] = useState(false);
  const cloud = process.env.NEXT_PUBLIC_CLOUD_MODE === "true";
  const [cloudEnabled, setCloudEnabled] = useState(false);
  useEffect(() => {
    if (!cloud) return;
    const abort = new AbortController();
    void fetch("/api/config", { cache: "no-store", signal: abort.signal }).then(response => response.ok ? response.json() : null)
      .then(config => { if (!abort.signal.aborted) setCloudEnabled(config?.demoSignalsEnabled === true); }).catch(() => {});
    return () => abort.abort();
  }, [cloud]);

  function send(scenario: Scenario) {
    if (disabled || (scenario === "duplicate" && !last.current)) return;
    void run(async () => {
      const readings: Record<Exclude<Scenario, "duplicate">, { A: number | null; B: number | null }> = {
        "clear-a": {A:-48,B:-73}, "clear-b": {A:-73,B:-48}, ambiguous:{A:-55,B:-57},
        tie:{A:-56,B:-56}, unknown:{A:null,B:null}, "put-back":{A:-48,B:-73},
      };
      const payload = scenario === "duplicate" ? last.current! : {
        eventId: `web-demo-${crypto.randomUUID()}`, shelfId: selectedShelf, laneId: lane,
        eventType: scenario === "put-back" ? "PUT_BACK" as const : "PICK" as const,
        rssi: readings[scenario],
      };
      const result = await submitShelfEvent(payload);
      if (!result.duplicate) { last.current = payload; setHasLast(true); }
      return result.duplicate ? "Duplicate event ถูกข้าม cart ไม่เพิ่มซ้ำ"
        : result.disposition === "CONFIRMED" ? `${result.event.eventType} · Basket ${result.basketId} · ยืนยันแล้ว`
          : `${result.event.eventType} · ${result.caseId} · รอการตรวจสอบ`;
    });
  }

  if (cloud ? !cloudEnabled : process.env.NODE_ENV !== "development") return null;
  return (
    <details className={`${styles.card} ${styles.simulator}`}>
      <summary><FlaskConical size={18} aria-hidden="true" /> {cloud ? "Cloud simulator" : "Local simulator"} <span>จำลอง event สำหรับทดสอบ</span></summary>
      <p className={styles.muted}>ส่งสัญญาณจำลองแทน ESP32</p>
      <p className={styles.muted}>{getShelfProduct(selectedShelf)?.name}</p>
      <p className={styles.footnote}>เชื่อมตะกร้าใน Shopper ก่อนเริ่มทดสอบ</p>
      <div className={styles.simulatorPickers}>
        <label className={styles.lanePicker}>Shelf<select aria-label="Simulator shelf" value={selectedShelf} disabled={disabled} onChange={event => { setSelectedShelf(event.target.value); last.current = null; setHasLast(false); }}>{SHELF_OPTIONS.map(shelf => <option key={shelf.shelfId} value={shelf.shelfId} disabled={!shelf.enabled}>{shelf.label}{shelf.enabled ? "" : " · ยังไม่เปิดใช้"}</option>)}</select></label>
        <label className={styles.lanePicker}>Shelf lane<select value={lane} disabled={disabled} onChange={(event)=>setLane(event.target.value)}><option value="LANE-1">ช่อง 1</option><option value="LANE-2">ช่อง 2</option></select></label>
      </div>
      <div className={styles.simulatorGrid}>{scenarios.map(item=><div key={item.id}><div><h3>{item.label}</h3><p>{item.description}</p></div><button className={styles.outlineButton} disabled={disabled || (item.id==="duplicate" && !hasLast)} onClick={()=>send(item.id)}><Send size={13} aria-hidden="true" /> {item.label}</button></div>)}</div>
    </details>
  );
}
