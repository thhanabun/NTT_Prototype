import type { ReactNode } from "react";
import { CheckCheck, Clock3, FileSearch } from "lucide-react";
import type { BasketCase, Product } from "@/lib/api/types";
import styles from "./admin.module.css";

export const caseStatusLabel = { WAITING_CUSTOMER: "รอลูกค้ายืนยัน", OPEN_STAFF: "รอพนักงาน", CLOSED: "ปิดเคสแล้ว" };
export const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString("th-TH", {timeZone: "Asia/Bangkok"}) : "ยังไม่มีข้อมูล";

export function CaseDetails({ item, product, actions }: { item: BasketCase; product?: Product; actions?: ReactNode }) {
  const rssi = item.evidence.rssi;
  const hasAgentMock = item.toolCalls.length > 0;
  return (
    <section className={styles.card} aria-labelledby="case-detail-heading">
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>CASE DETAIL</p><h2 id="case-detail-heading">{item.caseId}</h2></div><span className={`${styles.badge} ${item.status === "OPEN_STAFF" ? styles.amber : item.status === "CLOSED" ? styles.green : styles.blue}`}>{caseStatusLabel[item.status]}</span></div>
      <div className={styles.caseIntro}><FileSearch size={23} aria-hidden="true" /><div><h3>{product?.name ?? item.sku}</h3><p>{item.type.replaceAll("_", " ")} · {item.eventType}</p></div></div>
      <p className={styles.reason}>{item.reason}</p>
      <dl className={styles.details}>
        <div><dt>Event ID</dt><dd>{item.eventId}</dd></div><div><dt>สร้างเมื่อ</dt><dd>{formatTime(item.createdAt)}</dd></div>
        <div><dt>ตะกร้าที่เสนอ</dt><dd>{item.candidate ? `Basket ${item.candidate}` : "ยังระบุไม่ได้"}</dd></div><div><dt>การทำงานที่เสนอ</dt><dd>{item.proposedAction}</dd></div>
        <div><dt>ขั้นตอนถัดไป</dt><dd>{item.nextAction}</dd></div><div><dt>Zone evidence</dt><dd>{item.evidence.zone ?? "—"}</dd></div>
        <div><dt>RSSI A / B</dt><dd>{rssi?.A ?? "—"} / {rssi?.B ?? "—"} dBm</dd></div>
        {item.evidence.marginDb !== undefined && <div><dt>Signal margin</dt><dd>{item.evidence.marginDb} dB</dd></div>}
        {item.evidence.cartQuantity !== undefined && <div><dt>Confirmed quantity at event</dt><dd>{item.evidence.cartQuantity}</dd></div>}
      </dl>
      <div className={styles.confidence}><div><span>{hasAgentMock ? "Agent confidence · simulation" : "Deterministic policy confidence"}</span><strong>{Math.round(item.confidence * 100)}%</strong></div><div className={styles.confidenceTrack}><span style={{width: `${Math.max(0, Math.min(100, item.confidence * 100))}%`}} /></div><p>{hasAgentMock ? "คำแนะนำจาก local mock ยังไม่มีการเรียก AI model" : "ประมวลผลด้วยกฎของ backend ไม่มีการเรียก Agent"}</p></div>
      {item.toolCalls.length > 0 && <div className={styles.tools}>{item.toolCalls.map((tool, index) => <span key={`${tool.name}-${index}`}>{tool.name} · {tool.status}</span>)}</div>}
      {item.status === "WAITING_CUSTOMER" && <div className={styles.info}><Clock3 size={18} aria-hidden="true" /><p>รอคำตอบจากลูกค้า เคสนี้ยังไม่มีปุ่มตัดสินของพนักงาน กรุณาเปิด Shopper ของ Basket {item.candidate ?? "ที่เกี่ยวข้อง"}</p></div>}
      {item.resolution && <div className={styles.info}><CheckCheck size={19} aria-hidden="true" /><p>{item.resolution.actor} · {item.resolution.decision}{item.resolution.basketId ? ` · Basket ${item.resolution.basketId}` : ""}</p></div>}
      {actions}
      <div className={styles.timeline}><h3>Case timeline</h3><ol>{item.timeline.map((entry, index) => <li key={`${entry.at}-${index}`}><span className={styles.timelineDot} /><div><strong>{entry.action.replaceAll("_", " ")}</strong><time dateTime={entry.at}>{formatTime(entry.at)}</time>{entry.basketId && <p>Basket {entry.basketId}</p>}{entry.nextAction && <p>Next: {entry.nextAction}</p>}{entry.reason && <p>{entry.reason}</p>}</div></li>)}</ol></div>
    </section>
  );
}
