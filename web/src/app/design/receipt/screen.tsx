"use client";

import { ArrowRight } from "lucide-react";
import { bySku, money, useDemoBasket } from "../_shared/demo";
import s from "./receipt.module.css";

export function ReceiptScreen({ fontClass }: { fontClass: string }) {
  const b = useDemoBasket();
  const p = b.pending ? bySku(b.pending.sku) : null;
  return (
    <div className={`${s.screen} ${fontClass}`}>
      <header className={s.top}><span>FAST — ตะกร้า A</span><span>23.10.26 · 10:31</span></header>
      <h1 className={s.title}>ตะกร้า<br />ของคุณ<sup>{b.count}</sup></h1>
      <p className={s.sub}>หยิบจากชั้นได้เลย รายการจะพิมพ์ลงใบเสร็จนี้เอง</p>

      <section className={s.paper} aria-label="ใบเสร็จ">
        <div className={s.paperHead}><span>{b.paid ? "ORDER · PAID" : "ORDER · DRAFT"}</span><span>SES-DEMO-A</span></div>
        <ul>
          {b.lines.map((l) => {
            const it = bySku(l.sku);
            return <li key={l.sku}><span>{it.name}{l.qty > 1 && <em> ×{l.qty}</em>}</span><i /><b>{money(it.price * l.qty)}</b></li>;
          })}
        </ul>

        {p && (
          <div className={s.pending} role="group" aria-labelledby="pending-h">
            <div className={s.pendingLine}><span id="pending-h">{p.name}?</span><i /><b>{money(p.price)}</b></div>
            <p>ระบบไม่แน่ใจว่าคุณหยิบชิ้นนี้ ยังไม่นับในยอด</p>
            <div className={s.pendingBtns}>
              <button onClick={() => b.confirm(true)}>ใช่ ของฉัน</button>
              <button onClick={() => b.confirm(false)}>ไม่ใช่</button>
            </div>
          </div>
        )}
        {!p && b.staff > 0 && <p className={s.note}>※ ส่ง 1 รายการให้พนักงานตรวจสอบ</p>}

        <div className={s.total}><span>รวม</span><b>{money(b.total)}</b></div>
        <p className={s.fine}>นับเฉพาะรายการที่ยืนยันแล้ว · VAT included</p>
        {b.paid && <span className={s.stamp}>ชำระแล้ว</span>}
      </section>

      {!p && !b.paid && <button className={s.sim} onClick={b.simulatePick}>+ จำลองการหยิบสินค้า</button>}

      <div className={s.pay}>
        {b.paid ? (
          <button onClick={b.reset}>เริ่มตะกร้าใหม่ <ArrowRight size={18} aria-hidden="true" /></button>
        ) : (
          <>
            {b.blockReason && <p>{b.blockReason}</p>}
            <button disabled={!b.canPay} onClick={b.pay}>ชำระเงิน {money(b.total)} <ArrowRight size={18} aria-hidden="true" /></button>
          </>
        )}
      </div>
    </div>
  );
}
