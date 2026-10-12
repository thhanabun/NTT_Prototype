"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, Clock3, LoaderCircle, Radio, RefreshCw, ShoppingBasket, Signal, Store } from "lucide-react";
import { useAdmin } from "./use-admin";
import { CaseDetails, caseStatusLabel, formatTime } from "./case-details";
import { StaffActions } from "./staff-actions";
import { LocalSimulator } from "./local-simulator";
import { ConnectionStatus } from "@/components/connection-status";
import styles from "./admin.module.css";

const money = (value: number) => `฿${value.toLocaleString("th-TH")}`;
type Filter = "OPEN" | "ALL" | "WAITING_CUSTOMER" | "OPEN_STAFF" | "CLOSED";
const filters: {id:Filter; label:string}[] = [{id:"OPEN",label:"เคสที่ยังเปิด"},{id:"OPEN_STAFF",label:"รอพนักงาน"},{id:"WAITING_CUSTOMER",label:"รอลูกค้า"},{id:"CLOSED",label:"ปิดแล้ว"},{id:"ALL",label:"ทั้งหมด"}];

export function AdminDashboard() {
  const admin = useAdmin();
  const [filter, setFilter] = useState<Filter>("OPEN");
  const state = admin.state;
  const openCases = state?.cases.filter((item) => item.status !== "CLOSED") ?? [];
  const cases = state?.cases.filter((item) => filter === "ALL" || (filter === "OPEN" ? item.status !== "CLOSED" : item.status === filter)) ?? [];
  return (
    <div className={styles.dashboard} lang="th">
      <div className={styles.hero}><div><p className={styles.eyebrow}>BASKETLY / STORE OPERATIONS</p><h1>ภาพรวมร้านของคุณ<span>.</span></h1><p>ตรวจตะกร้า ติดตามหลักฐาน และจัดการรายการที่ต้องยืนยัน</p></div><button className={styles.outlineButton} disabled={admin.loading || admin.pending} onClick={() => void admin.refresh()}><RefreshCw size={16} aria-hidden="true" /> อัปเดต dashboard</button></div>
      <div className={styles.updateBar}><span className={`${styles.badge} ${admin.stale ? styles.amber : styles.green}`}><ConnectionStatus connection={admin.connection} retryAttempt={admin.retryAttempt} stale={admin.stale} /></span><span>ข้อมูลล่าสุด: {formatTime(admin.updatedAt)}</span></div>
      {admin.error && <div className={styles.error} role="alert"><CircleAlert size={20} aria-hidden="true" /><div>{admin.error}<button disabled={admin.loading || admin.pending} onClick={() => void admin.refresh()}>ลองโหลดใหม่</button></div></div>}
      {admin.notice && <p className={styles.notice} role="status">{admin.notice}</p>}
      {admin.loading && <p className={styles.loading} role="status"><LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> กำลังโหลดข้อมูลร้าน…</p>}
      <section className={styles.metrics} aria-label="Store metrics">
        {[{label:"SHELF REPORTED STATUS",value:state?.shelf.status ?? "—",icon:Store,note:state?.shelf.shelfId ?? "รอข้อมูล"},{label:"ACTIVE BASKETS",value:state?.baskets.filter((basket)=>basket.session).length ?? "—",icon:ShoppingBasket,note:"Basket A / Basket B"},{label:"OPEN CASES (LOADED)",value:state ? openCases.length : "—",icon:CircleAlert,note:"จากเคสล่าสุดที่โหลด"},{label:"WORKFLOW STATE",value:state?.shelf.fsmState ?? "—",icon:Radio,note:"Deterministic backend policy"}].map(({label,value,icon:Icon,note})=><article className={styles.metric} key={label}><div><span>{label}</span><Icon size={18} aria-hidden="true" /></div><strong>{value}</strong><p>{note}</p></article>)}
      </section>
      <div className={styles.overviewGrid}>
        <section className={styles.card} aria-labelledby="proximity-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>SHELF EVIDENCE</p><h2 id="proximity-heading">Basket proximity</h2></div><Signal size={23} aria-hidden="true" /></div><p className={styles.muted}>RSSI เป็นหลักฐานความใกล้ ไม่ใช่ตำแหน่งที่แน่นอน</p>{(["A","B"] as const).map((id)=>{const reading=state?.shelf.rssi[id];return <div className={styles.signalRow} key={id}><span>Basket {id}</span><div className={styles.signalTrack}><span style={{width:reading===null || reading===undefined ? "0%" : `${Math.max(3,Math.min(100,(reading+100)*1.5))}%`}} /></div><strong>{reading??"—"}{reading!==null && reading!==undefined ? " dBm" : ""}</strong></div>;})}<p className={styles.footnote}>Last shelf event: {formatTime(state?.recentEvents[0]?.receivedAt)}<br />สถานะ ONLINE เป็นค่าที่ backend รายงาน ยังไม่มี heartbeat ตรวจ offline อัตโนมัติ</p></section>
        <section className={styles.card} aria-labelledby="baskets-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>BASKETS</p><h2 id="baskets-heading">ตะกร้าในร้าน</h2></div><ShoppingBasket size={23} aria-hidden="true" /></div><div className={styles.basketGrid}>{state?.baskets.map((basket)=><article className={styles.basket} key={basket.basketId}><div><h3>Basket {basket.basketId}</h3><span className={`${styles.badge} ${basket.session?styles.green:styles.neutral}`}>{basket.session?"Active":"Idle"}</span></div><strong className={styles.basketTotal}>{money(basket.total)}</strong><p>{basket.lines.reduce((sum,line)=>sum+line.quantity,0)} confirmed items · {basket.unresolvedCaseCount} pending</p>{basket.lines.length ? <ul>{basket.lines.map(line=><li key={line.sku}>{line.name} ×{line.quantity}<span>{money(line.subtotal)}</span></li>)}</ul>:<p className={styles.muted}>ยังไม่มีสินค้าที่ยืนยัน</p>}<p className={styles.footnote}>{!basket.session?"ต้องเริ่ม session":basket.unresolvedCaseCount?"รอเคสก่อน checkout":basket.lines.length&&basket.payable?"พร้อม mock checkout":"ตะกร้าว่าง"}</p><Link href={`/shopper?basket=${basket.basketId}`}>เปิด Shopper →</Link></article>)}</div></section>
      </div>
      <div className={styles.caseGrid}>
        <section className={styles.card} aria-labelledby="cases-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>CASE MONITOR</p><h2 id="cases-heading">รายการที่ต้องตรวจสอบ</h2></div><span className={styles.badge}>{cases.length}</span></div><div className={styles.filters} role="group" aria-label="Filter cases">{filters.map(item=><button key={item.id} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{item.label}</button>)}</div><p className={styles.footnote}>แสดงได้สูงสุด 30 เคสล่าสุด ไม่ใช่จำนวนเคสทั้งหมดในระบบ</p><div className={styles.caseList}>{cases.length ? cases.map(item=><button className={`${styles.caseButton} ${admin.selectedCase?.caseId===item.caseId ? styles.selectedCase:""}`} key={item.caseId} disabled={admin.loading || admin.pending} aria-pressed={admin.selectedCase?.caseId===item.caseId} onClick={()=>admin.selectCase(item.caseId)}><div><strong>{item.caseId}</strong><span className={`${styles.badge} ${item.status==="OPEN_STAFF"?styles.amber:item.status==="CLOSED"?styles.green:styles.blue}`}>{caseStatusLabel[item.status]}</span></div><h3>{state?.products.find(product=>product.sku===item.sku)?.name??item.sku} · {item.eventType}</h3><p>{item.type.replaceAll("_"," ")}</p><small>{item.candidate?`Basket ${item.candidate}`:"ยังไม่ทราบตะกร้า"} · {formatTime(item.createdAt)}</small></button>):<div className={styles.empty}><CheckIcon /><h3>ไม่มีเคสในหมวดนี้</h3><p>เหตุการณ์ที่ต้องยืนยันจะปรากฏที่นี่</p></div>}</div></section>
        {admin.selectedCase ? <CaseDetails item={admin.selectedCase} product={state?.products.find(item=>item.sku===admin.selectedCase?.sku)} actions={<StaffActions item={admin.selectedCase} baskets={state?.baskets ?? []} disabled={admin.loading || admin.pending || admin.stale} pending={admin.pending} onDecide={(decision,target)=>void admin.decide(decision,target)} />} />:<section className={styles.card}><div className={styles.empty}><Clock3 size={30} aria-hidden="true" /><h3>{admin.selectedId?"เคสนี้ไม่อยู่ใน snapshot ล่าสุด":"เลือกเคสเพื่อดูรายละเอียด"}</h3><p>หลักฐาน คำแนะนำ และ timeline จะแสดงที่นี่</p></div></section>}
      </div>
      <section className={styles.card} aria-labelledby="activity-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>RECENT ACTIVITY</p><h2 id="activity-heading">เหตุการณ์ล่าสุด</h2></div><span className={styles.smallLabel}>20 MOST RECENT</span></div>{state?.recentEvents.length ? <ol className={styles.events}>{state.recentEvents.map(event=><li key={event.eventId}><span className={styles.eventIcon}>{event.eventType==="PICK"?"↗":"↙"}</span><div><strong>{event.eventType} · {state.products.find(product=>product.sku===event.sku)?.name??event.sku}</strong><p>{event.eventId} · {event.shelfId} / {event.laneId}</p></div><time dateTime={event.receivedAt}>{formatTime(event.receivedAt)}</time></li>)}</ol>:<p className={styles.muted}>ยังไม่มี shelf event</p>}</section>
      <LocalSimulator disabled={admin.loading || admin.pending || admin.stale} shelfId={state?.shelf.shelfId ?? "SHELF-01"} run={admin.execute} />
    </div>
  );
}

function CheckIcon() { return <ShoppingBasket size={28} aria-hidden="true" />; }
