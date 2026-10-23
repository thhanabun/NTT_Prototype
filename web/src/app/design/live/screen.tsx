"use client";

import { Activity, ArrowDownLeft, ArrowUpRight, Check, Radio, ShieldCheck, X } from "lucide-react";
import { bySku, money, useDemoBasket } from "../_shared/demo";
import s from "./live.module.css";

const pad = (n: number) => n.toFixed(2).padStart(6, "0");

export function LiveScreen({ fontClass }: { fontClass: string }) {
  const b = useDemoBasket();
  const p = b.pending ? bySku(b.pending.sku) : null;
  const feed = [
    ...(p ? [{ t: "10:31:08", kind: "wait", text: `PICK · ${p.name}`, note: "รอคุณยืนยัน" }] : []),
    ...(b.staff ? [{ t: "10:31:02", kind: "staff", text: "ส่งพนักงานตรวจ", note: "กำลังตรวจสอบ" }] : []),
    ...b.lines.map((l, i) => ({ t: `10:2${8 - i}:${(14 + i * 9) % 60}`.replace(/:(\d)$/, ":0$1"), kind: "ok", text: `PICK · ${bySku(l.sku).name} ×${l.qty}`, note: "ยืนยันอัตโนมัติ · สัญญาณชัด" })),
    { t: "10:24:15", kind: "start", text: "SESSION START", note: "Basket A · QR" },
  ];

  return (
    <div className={`${s.screen} ${fontClass}`}>
      <header className={s.top}>
        <span className={s.brand}>FAST<em>/live</em></span>
        <span className={s.live}><i /> LIVE</span>
      </header>

      <section className={s.signal} aria-label="สถานะตะกร้า">
        <div className={s.bars} aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= 4 ? s.on : ""} style={{ height: 6 + n * 4 }} />)}</div>
        <div><b>BASKET A</b><small>ใกล้ชั้น 06 · −58 dBm</small></div>
        <Radio size={18} aria-hidden="true" />
      </section>

      <section className={s.total}>
        <small>ยอดที่ยืนยันแล้ว</small>
        <strong><span>฿</span>{pad(b.total)}</strong>
        <div className={s.meta}>
          <span>{b.count} ITEMS</span>
          {p && <span className={s.amber}>+{money(p.price)} รอยืนยัน</span>}
        </div>
      </section>

      {p ? (
        <section className={s.alert} aria-labelledby="alert-h">
          <div className={s.alertTop}><span><Activity size={13} aria-hidden="true" /> PICK DETECTED</span><span>LANE {p.lane}</span></div>
          <div className={s.alertBody}>
            <span className={s.glyph} style={{ color: p.ink }}><p.icon size={34} strokeWidth={1.5} aria-hidden="true" /></span>
            <div><h2 id="alert-h">{p.name}</h2><p>สัญญาณ 2 ตะกร้าใกล้กัน · ต้องการคำยืนยัน</p></div>
          </div>
          <div className={s.meter} aria-hidden="true"><i style={{ width: "54%" }} /><i style={{ width: "46%" }} /></div>
          <div className={s.meterLabels} aria-hidden="true"><span>A 54%</span><span>B 46%</span></div>
          <div className={s.btns}>
            <button className={s.yes} onClick={() => b.confirm(true)}><Check size={18} aria-hidden="true" /> ของฉัน</button>
            <button className={s.no} onClick={() => b.confirm(false)}><X size={18} aria-hidden="true" /> ไม่ใช่</button>
          </div>
        </section>
      ) : (
        <button className={s.sim} onClick={b.simulatePick}>[ จำลอง PICK event ]</button>
      )}

      <section className={s.feed} aria-labelledby="feed-h">
        <h2 id="feed-h">EVENT STREAM</h2>
        <ol>
          {feed.map((e, i) => (
            <li key={i} className={s[e.kind]}>
              <time>{e.t}</time>
              <span className={s.node}>{e.kind === "ok" ? <ArrowUpRight size={12} aria-hidden="true" /> : e.kind === "start" ? <Radio size={12} aria-hidden="true" /> : <ArrowDownLeft size={12} aria-hidden="true" />}</span>
              <div><b>{e.text}</b><small>{e.note}</small></div>
            </li>
          ))}
        </ol>
      </section>

      <div className={s.pay}>
        <p><ShieldCheck size={14} aria-hidden="true" /> {b.blockReason || "นับเฉพาะรายการที่ยืนยันแล้ว"}</p>
        <button disabled={!b.canPay} onClick={b.pay}><span>CHECKOUT</span><b>{money(b.total)}</b></button>
      </div>

      {b.paid && (
        <div className={s.done} role="dialog" aria-labelledby="done-h">
          <code>ORDER MOCK-001 · OK</code>
          <h2 id="done-h">ชำระเรียบร้อย</h2>
          <strong>{money(b.total)}</strong>
          <button onClick={b.reset}>NEW SESSION</button>
        </div>
      )}
    </div>
  );
}
