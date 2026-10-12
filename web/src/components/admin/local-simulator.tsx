"use client";

import { useRef, useState } from "react";
import { FlaskConical, Send } from "lucide-react";
import { submitShelfEvent } from "@/lib/api/client";
import type { ShelfEventInput } from "@/lib/api/types";
import styles from "./admin.module.css";

const scenarios = [
  {id:"clear-a",label:"Clear pick → A",description:"Basket A มี RSSI ใกล้กว่าชัดเจน"},
  {id:"clear-b",label:"Clear pick → B",description:"Basket B มี RSSI ใกล้กว่าชัดเจน"},
  {id:"ambiguous",label:"Ambiguous pick",description:"ใกล้กันมาก ขอคำยืนยันจากลูกค้า A"},
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
  const last = useRef<ShelfEventInput | null>(null);
  const [hasLast, setHasLast] = useState(false);

  function send(scenario: Scenario) {
    if (disabled || (scenario === "duplicate" && !last.current)) return;
    void run(async () => {
      const readings: Record<Exclude<Scenario, "duplicate">, { A: number | null; B: number | null }> = {
        "clear-a": {A:-48,B:-73}, "clear-b": {A:-73,B:-48}, ambiguous:{A:-55,B:-57},
        tie:{A:-56,B:-56}, unknown:{A:null,B:null}, "put-back":{A:-48,B:-73},
      };
      const payload = scenario === "duplicate" ? last.current! : {
        eventId: `web-demo-${crypto.randomUUID()}`, shelfId, laneId: lane,
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

  if (process.env.NODE_ENV !== "development") return null;
  return (
    <details className={`${styles.card} ${styles.simulator}`}>
      <summary><FlaskConical size={18} aria-hidden="true" /> Local simulator <span>จำลอง event สำหรับทดสอบ</span></summary>
      <p className={styles.muted}>ปุ่มเหล่านี้ส่ง event เข้า backend ในเครื่องจริง ใช้แทน ESP32 ระหว่างพัฒนา ไม่ใช่ปุ่มเพิ่มสินค้าใน Shopper</p>
      <p className={styles.footnote}>เริ่ม session ของ Basket ที่ต้องการใน Shopper ก่อนทดสอบ หากไม่มี session จะเกิดเคสให้พนักงานตรวจสอบ</p>
      <label className={styles.lanePicker}>Shelf lane<select value={lane} disabled={disabled} onChange={(event)=>setLane(event.target.value)}><option value="LANE-1">Lane 01 · Coke</option><option value="LANE-2">Lane 02 · Water</option></select></label>
      <div className={styles.simulatorGrid}>{scenarios.map(item=><div key={item.id}><div><h3>{item.label}</h3><p>{item.description}</p></div><button className={styles.outlineButton} disabled={disabled || (item.id==="duplicate" && !hasLast)} onClick={()=>send(item.id)}><Send size={13} aria-hidden="true" /> {item.label}</button></div>)}</div>
    </details>
  );
}
