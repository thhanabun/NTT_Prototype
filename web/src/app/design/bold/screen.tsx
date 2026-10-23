"use client";

import { Check, PartyPopper, Plus, ShoppingBasket, X, Zap } from "lucide-react";
import { bySku, money, useDemoBasket } from "../_shared/demo";
import s from "./bold.module.css";

const tileColors = ["#7ad3ff", "#b6f36b", "#ff9bc0", "#ffd23f", "#c7a6ff", "#ffb36b"];

export function BoldScreen({ fontClass }: { fontClass: string }) {
  const b = useDemoBasket();
  const p = b.pending ? bySku(b.pending.sku) : null;
  return (
    <div className={`${s.screen} ${fontClass}`}>
      <header className={s.top}>
        <span className={s.logo}><Zap size={18} fill="currentColor" aria-hidden="true" /> FAST!</span>
        <span className={s.basket}><ShoppingBasket size={16} aria-hidden="true" /> ตะกร้า A <Check size={14} aria-hidden="true" /></span>
      </header>

      <section className={s.totalCard}>
        <small>ยอดตอนนี้</small>
        <strong>{money(b.total)}</strong>
        <span className={s.sticker}>{b.count} ชิ้น</span>
      </section>

      {p ? (
        <section className={s.ask} aria-labelledby="ask-h">
          <span className={s.askIcon} style={{ background: p.tint, color: p.ink }}><p.icon size={40} strokeWidth={1.8} aria-hidden="true" /></span>
          <h2 id="ask-h">เฮ้! หยิบ <u>{p.name}</u> มาใช่มั้ย?</h2>
          <p>ยังไม่นับในยอดจนกว่าจะกดยืนยันนะ</p>
          <div className={s.askBtns}>
            <button className={s.yes} onClick={() => b.confirm(true)}><Check size={20} strokeWidth={3} aria-hidden="true" /> ใช่!</button>
            <button className={s.no} onClick={() => b.confirm(false)}><X size={20} strokeWidth={3} aria-hidden="true" /> ไม่ใช่</button>
          </div>
        </section>
      ) : (
        <button className={s.sim} onClick={b.simulatePick}><Plus size={18} strokeWidth={3} aria-hidden="true" /> {b.staff ? "พนักงานกำลังเช็กให้… ลองหยิบอีก" : "จำลองการหยิบ"}</button>
      )}

      <h2 className={s.h}>ของในตะกร้า</h2>
      <div className={s.tiles}>
        {b.lines.map((l, i) => {
          const it = bySku(l.sku);
          return (
            <article key={l.sku} className={s.tile} style={{ background: tileColors[i % tileColors.length] }}>
              <it.icon size={30} strokeWidth={2} aria-hidden="true" />
              <h3>{it.name}</h3>
              <b>{money(it.price * l.qty)}</b>
              {l.qty > 1 && <span className={s.qty}>×{l.qty}</span>}
            </article>
          );
        })}
      </div>

      <div className={s.pay}>
        {b.blockReason && <p>{b.blockReason}</p>}
        <button disabled={!b.canPay} onClick={b.pay}>จ่ายเลย {money(b.total)} →</button>
      </div>

      {b.paid && (
        <div className={s.done} role="dialog" aria-labelledby="done-h">
          <div className={s.doneCard}>
            <PartyPopper size={48} aria-hidden="true" />
            <h2 id="done-h">เรียบร้อย!</h2>
            <p>จ่ายแล้ว {money(b.total)} · ตัวอย่างเท่านั้น</p>
            <button onClick={b.reset}>ช้อปอีกรอบ</button>
          </div>
        </div>
      )}
    </div>
  );
}
