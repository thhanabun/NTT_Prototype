"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, Clock3, LoaderCircle, Radio, RefreshCw, ShoppingBasket, Store, TriangleAlert } from "lucide-react";
import { useAdmin } from "./use-admin";
import { CaseDetails, caseStatusLabel, formatTime } from "./case-details";
import { StaffActions } from "./staff-actions";
import { LocalSimulator } from "./local-simulator";
import { ShelfMonitor } from "./shelf-monitor";
import { releaseBasketSession } from "@/lib/api/client";
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
  const staffCases = state?.cases.filter((item) => item.status === "OPEN_STAFF") ?? [];
  const cases = state?.cases.filter((item) => filter === "ALL" || (filter === "OPEN" ? item.status !== "CLOSED" : item.status === filter)) ?? [];
  return (
    <div className={styles.dashboard} lang="th">
      <div className={styles.hero}><div><p className={styles.eyebrow}>STORE OVERVIEW</p><h1>ภาพรวมร้าน<span>.</span></h1></div><button className={styles.outlineButton} disabled={admin.loading || admin.pending} onClick={() => void admin.refresh()}><RefreshCw size={16} aria-hidden="true" /> อัปเดตข้อมูล</button></div>
      <div className={styles.updateBar}><span className={`${styles.badge} ${admin.stale ? styles.amber : styles.green}`}><ConnectionStatus connection={admin.connection} retryAttempt={admin.retryAttempt} stale={admin.stale} /></span><span>ข้อมูลล่าสุด: {formatTime(admin.updatedAt)}</span></div>
      {admin.error && <div className={styles.error} role="alert"><CircleAlert size={20} aria-hidden="true" /><div>{admin.error}<button disabled={admin.loading || admin.pending} onClick={() => void admin.refresh()}>ลองโหลดใหม่</button></div></div>}
      {admin.notice && <p className={styles.notice} role="status">{admin.notice}</p>}
      {admin.loading && <p className={styles.loading} role="status"><LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> กำลังโหลดข้อมูลร้าน…</p>}
      {staffCases.length > 0 && <section className={styles.attention} aria-label="ต้องดำเนินการ"><span className={styles.attentionIcon}><TriangleAlert size={22} aria-hidden="true" /></span><div><strong>มี {staffCases.length} เคสรอพนักงานตัดสิน</strong><span>รายการเหล่านี้ยังไม่รวมในยอดของลูกค้า</span></div><button className={styles.attentionButton} disabled={admin.loading || admin.pending} onClick={() => { setFilter("OPEN"); admin.selectCase(staffCases[0].caseId); }}>ตรวจเคสแรก →</button></section>}
      <section className={styles.metrics} aria-label="Store metrics">
        {[{label:"สถานะชั้นวาง",value:state?.shelf.device?.status ?? "UNKNOWN",icon:Store,note:state?.shelf.shelfId ?? "รอข้อมูล"},{label:"ตะกร้าที่ใช้งาน",value:state?.baskets.filter((basket)=>basket.session).length ?? "—",icon:ShoppingBasket,note:"ทั้งหมด 2 ใบ"},{label:"เคสเปิดล่าสุด",value:state ? openCases.length : "—",icon:CircleAlert,note:"สูงสุด 30 เคสล่าสุด"},{label:"สถานะการประมวลผล",value:state?.shelf.fsmState ?? "—",icon:Radio,note:"FSM"}].map(({label,value,icon:Icon,note})=><article className={styles.metric} key={label}><div><span>{label}</span><Icon size={18} aria-hidden="true" /></div><strong>{value}</strong><p>{note}</p></article>)}
      </section>
      {process.env.NEXT_PUBLIC_CLOUD_MODE === "true" && <div className={styles.updateBar}>{state?.baskets.filter(basket => basket.session && !basket.lines.length && !basket.unresolvedCaseCount).map(basket => <button key={basket.basketId} className={styles.outlineButton} disabled={admin.loading || admin.pending || admin.stale} onClick={() => void admin.execute(async () => { await releaseBasketSession(basket.basketId); return `คืน Basket ${basket.basketId} แล้ว พร้อมเริ่ม session ใหม่`; })}>คืน Basket {basket.basketId}</button>)}</div>}
      <div className={styles.overviewGrid}>
        <ShelfMonitor shelf={state?.shelf} />
        <section className={styles.card} aria-labelledby="baskets-heading"><div className={styles.sectionHeading}><div><h2 id="baskets-heading">ตะกร้าในร้าน</h2></div><ShoppingBasket size={23} aria-hidden="true" /></div><div className={styles.basketGrid}>{state?.baskets.map((basket)=><article className={styles.basket} key={basket.basketId}><div><h3>Basket {basket.basketId}</h3><span className={`${styles.badge} ${basket.session?styles.green:styles.neutral}`}>{basket.session?"ใช้งานอยู่":"ว่าง"}</span></div><strong className={styles.basketTotal}>{money(basket.total)}</strong><p>{basket.lines.reduce((sum,line)=>sum+line.quantity,0)} ชิ้น · รอยืนยัน {basket.unresolvedCaseCount} รายการ</p>{basket.lines.length ? <ul>{basket.lines.map(line=><li key={line.sku}>{line.name} ×{line.quantity}<span>{money(line.subtotal)}</span></li>)}</ul>:<p className={styles.muted}>ยังไม่มีสินค้า</p>}<p className={styles.footnote}>{!basket.session?"พร้อมใช้งาน":basket.unresolvedCaseCount?"รอตรวจสอบ":basket.lines.length&&basket.payable?"พร้อมชำระเงิน":"ตะกร้าว่าง"}</p><Link href={`/shopper?basket=${basket.basketId}`}>เปิด Shopper →</Link></article>)}</div></section>
      </div>
      <div className={styles.caseGrid}>
        <section className={styles.card} aria-labelledby="cases-heading"><div className={styles.sectionHeading}><div><h2 id="cases-heading">รายการที่ต้องตรวจสอบ</h2></div><span className={styles.badge}>{cases.length}</span></div><div className={styles.filters} role="group" aria-label="Filter cases">{filters.map(item=><button key={item.id} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{item.label}</button>)}</div><p className={styles.footnote}>30 เคสล่าสุด</p><div className={styles.caseList}>{cases.length ? cases.map(item=><button className={`${styles.caseButton} ${item.status==="OPEN_STAFF"?styles.caseStaff:item.status==="CLOSED"?styles.caseClosed:styles.caseCustomer} ${admin.selectedCase?.caseId===item.caseId ? styles.selectedCase:""}`} key={item.caseId} disabled={admin.loading || admin.pending} aria-pressed={admin.selectedCase?.caseId===item.caseId} onClick={()=>admin.selectCase(item.caseId)}><div><strong>{item.caseId}</strong><span className={`${styles.badge} ${item.status==="OPEN_STAFF"?styles.amber:item.status==="CLOSED"?styles.green:styles.blue}`}>{caseStatusLabel[item.status]}</span></div><h3>{state?.products.find(product=>product.sku===item.sku)?.name??item.sku} · {item.eventType}</h3><p>{item.type.replaceAll("_"," ")}</p><small>{item.candidate?`Basket ${item.candidate}`:"ยังไม่ทราบตะกร้า"} · {formatTime(item.createdAt)}</small></button>):<div className={styles.empty}><CheckIcon /><h3>ไม่มีเคสในหมวดนี้</h3></div>}</div></section>
        {admin.selectedCase ? <CaseDetails item={admin.selectedCase} product={state?.products.find(item=>item.sku===admin.selectedCase?.sku)} actions={<StaffActions item={admin.selectedCase} baskets={state?.baskets ?? []} disabled={admin.loading || admin.pending || admin.stale} pending={admin.pending} onDecide={(decision,target)=>void admin.decide(decision,target)} />} />:<section className={styles.card}><div className={styles.empty}><Clock3 size={30} aria-hidden="true" /><h3>{admin.selectedId?"ไม่พบเคสในข้อมูลล่าสุด":"เลือกเคสเพื่อดูรายละเอียด"}</h3></div></section>}
      </div>
      <div className={styles.logsGrid}>
      <section className={styles.card} aria-labelledby="activity-heading"><div className={styles.sectionHeading}><div><h2 id="activity-heading">เหตุการณ์ล่าสุด</h2></div><span className={styles.smallLabel}>20 รายการล่าสุด</span></div>{state?.recentEvents.length ? <ol className={styles.events} tabIndex={0} aria-label="เหตุการณ์ล่าสุด">{state.recentEvents.map(event=><li key={event.eventId}><span className={styles.eventIcon}>{event.eventType==="PICK"?"↗":"↙"}</span><div><strong>{event.eventType} · {state.products.find(product=>product.sku===event.sku)?.name??event.sku}</strong><p>{event.eventId} · {event.shelfId} / {event.laneId}</p></div><time dateTime={event.receivedAt}>{formatTime(event.receivedAt)}</time></li>)}</ol>:<p className={styles.muted}>ยังไม่มีเหตุการณ์</p>}</section>
      <section className={styles.card} aria-labelledby="audit-heading"><div className={styles.sectionHeading}><div><h2 id="audit-heading">บันทึกการทำงาน</h2></div><span className={styles.smallLabel}>100 รายการล่าสุด</span></div>{state?.auditLog?.length ? <ol className={styles.events} tabIndex={0} aria-label="บันทึกการทำงาน">{state.auditLog.map(entry => <li key={entry.auditId}><div><strong>{entry.action}</strong><p>{entry.actor} · {String(entry.details.caseId ?? entry.details.eventId ?? entry.auditId)}</p></div><time dateTime={entry.at}>{formatTime(entry.at)}</time></li>)}</ol> : <p className={styles.muted}>ยังไม่มี audit log</p>}</section>
      </div>
      {process.env.NEXT_PUBLIC_CLOUD_MODE !== "true" && <LocalSimulator disabled={admin.loading || admin.pending || admin.stale} shelfId={state?.shelf.shelfId ?? "SHELF-01"} run={admin.execute} />}
    </div>
  );
}

function CheckIcon() { return <ShoppingBasket size={28} aria-hidden="true" />; }
