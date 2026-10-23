"use client";

import { Bell, Check, CheckCheck, Plus, ScanLine, ShoppingBasket, Sparkles, X } from "lucide-react";
import { bySku, money, products, useDemoBasket } from "../_shared/demo";
import s from "./warm.module.css";

const SEGMENTS = 13;
const BUDGET = 150;

function Gauge({ total, pending }: { total: number; pending: number }) {
  const filled = Math.min(SEGMENTS, Math.round((total / BUDGET) * SEGMENTS));
  const pend = Math.min(SEGMENTS - filled, Math.ceil((pending / BUDGET) * SEGMENTS));
  return (
    <svg viewBox="0 0 300 200" className={s.gauge} aria-hidden="true">
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const angle = -100 + (200 / (SEGMENTS - 1)) * i;
        const fill = i < filled ? `hsl(${22 + i * 1.6} 90% ${58 + i * 0.6}%)` : i < filled + pend ? "#f6c7a4" : "#e4dbcf";
        return <rect key={i} x={138} y={6} width={24} height={46} rx={10} fill={fill}
          transform={`rotate(${angle} 150 150)`} className={i >= filled && i < filled + pend ? s.pulse : undefined} />;
      })}
    </svg>
  );
}

export function WarmScreen({ fontClass }: { fontClass: string }) {
  const b = useDemoBasket();
  const p = b.pending ? bySku(b.pending.sku) : null;
  return (
    <div className={`${s.screen} ${fontClass}`}>
      <header className={s.header}>
        <span className={s.chip}><ShoppingBasket size={15} aria-hidden="true" /> Basket A <i>เชื่อมแล้ว</i></span>
        <button className={s.round} aria-label="การแจ้งเตือน"><Bell size={17} aria-hidden="true" /></button>
      </header>

      <section className={s.gaugeCard} aria-label="สรุปยอด">
        <Gauge total={b.total} pending={b.pendingValue} />
        <div className={s.gaugeText}>
          <Sparkles size={16} aria-hidden="true" />
          <small>{b.count} ชิ้นในตะกร้า</small>
          <strong>{money(b.total)}</strong>
          <span>งบที่ตั้งไว้ {money(BUDGET)}</span>
        </div>
      </section>

      <section className={s.scan} aria-labelledby="scan-h">
        <div className={s.scanHead}><h2 id="scan-h"><ScanLine size={16} aria-hidden="true" /> ชั้นวางตรวจจับ</h2><span>สด</span></div>
        <div className={s.shelf} aria-hidden="true">
          {products.slice(0, 6).map((item) => (
            <span key={item.sku} className={`${s.shelfItem} ${p?.sku === item.sku ? s.target : ""}`} style={{ background: item.tint, color: item.ink }}><item.icon size={26} strokeWidth={1.6} /></span>
          ))}
          {p && <span className={s.tag} style={{ left: `${(products.findIndex((x) => x.sku === p.sku) % 3) * 33 + 8}%`, top: products.findIndex((x) => x.sku === p.sku) < 3 ? "4%" : "50%" }}>{p.name} · {money(p.price)}</span>}
        </div>
        {p ? (
          <div className={s.ask} role="group" aria-labelledby="ask-h">
            <h3 id="ask-h">คุณหยิบ <b>{p.name}</b> ใช่ไหม?</h3>
            <p>ระบบยังแยกตะกร้าไม่ได้ชัด รายการนี้ยังไม่รวมในยอด</p>
            <div className={s.askBtns}>
              <button className={s.yes} onClick={() => b.confirm(true)}><Check size={17} aria-hidden="true" /> ใช่ ฉันหยิบ</button>
              <button className={s.no} onClick={() => b.confirm(false)}><X size={17} aria-hidden="true" /> ไม่ใช่</button>
            </div>
          </div>
        ) : (
          <div className={s.calm}>
            <p>{b.staff ? "ส่งให้พนักงานตรวจสอบแล้ว รอสักครู่…" : "ทุกอย่างเรียบร้อย ไม่มีรายการรอยืนยัน"}</p>
            <button onClick={b.simulatePick}><Plus size={15} aria-hidden="true" /> จำลองการหยิบ</button>
          </div>
        )}
      </section>

      <section className={s.list} aria-labelledby="list-h">
        <div className={s.listHead}><h2 id="list-h">ในตะกร้า</h2><span>ยืนยันแล้ว {b.count}</span></div>
        {b.lines.map((l) => {
          const item = bySku(l.sku);
          return (
            <div className={s.row} key={l.sku}>
              <span className={s.thumb} style={{ background: item.tint, color: item.ink }}><item.icon size={22} strokeWidth={1.7} aria-hidden="true" /></span>
              <div><h3>{item.name}</h3><p>{item.detail} · ×{l.qty}</p></div>
              <strong>{money(item.price * l.qty)}</strong>
            </div>
          );
        })}
      </section>

      <div className={s.payBar}>
        {b.blockReason && <p>{b.blockReason}</p>}
        <button disabled={!b.canPay} onClick={b.pay}>ชำระเงิน <b>{money(b.total)}</b></button>
      </div>

      {b.paid && (
        <div className={s.done} role="dialog" aria-labelledby="done-h">
          <span><CheckCheck size={30} aria-hidden="true" /></span>
          <h2 id="done-h">ชำระเรียบร้อย</h2>
          <p>{money(b.total)} · {b.count} ชิ้น · ใบเสร็จตัวอย่าง</p>
          <button onClick={b.reset}>เริ่มช้อปใหม่</button>
        </div>
      )}
    </div>
  );
}
