"use client";

import { useState } from "react";
import { Bell, Check, ChevronRight, CircleAlert, House, MapPin, ReceiptText, ScanLine, Search, ShoppingBasket, User, X, Zap } from "lucide-react";
import { bySku, money, products, useDemoBasket } from "../_shared/demo";
import s from "./mart.module.css";

const cats = ["ทั้งหมด", "เครื่องดื่ม", "ขนม", "นม", "อาหาร"];

export function MartScreen({ fontClass }: { fontClass: string }) {
  const b = useDemoBasket();
  const [sheet, setSheet] = useState<"confirm" | "cart" | null>(null);
  const [cat, setCat] = useState(0);
  const p = b.pending ? bySku(b.pending.sku) : null;
  const qtyOf = (sku: string) => b.lines.find((l) => l.sku === sku)?.qty ?? 0;

  return (
    <div className={`${s.screen} ${fontClass}`}>
      <header className={s.head}>
        <div className={s.headRow}>
          <div><small>ช้อปที่สาขา</small><p><MapPin size={14} aria-hidden="true" /> FAST บางมด <ChevronRight size={14} aria-hidden="true" /></p></div>
          <button className={s.icon} aria-label="การแจ้งเตือน"><Bell size={18} aria-hidden="true" /><i /></button>
        </div>
        <label className={s.search}><Search size={17} aria-hidden="true" /><input placeholder="ค้นหาสินค้าในร้าน" /></label>
        <div className={s.basketPill}><ShoppingBasket size={16} aria-hidden="true" /><span><b>ตะกร้า A</b> เชื่อมแล้ว · หยิบจากชั้น ระบบเพิ่มให้เอง</span></div>
      </header>

      <div className={s.body}>
        <section className={s.banner}>
          <div><span>ใหม่</span><h2>หยิบ จ่าย ไปได้เลย</h2><p>ไม่ต้องต่อคิว ไม่ต้องสแกนทีละชิ้น</p></div>
          <Zap size={64} strokeWidth={1.4} aria-hidden="true" />
        </section>

        {p && (
          <button className={s.alert} onClick={() => setSheet("confirm")}>
            <CircleAlert size={20} aria-hidden="true" />
            <span><b>ยืนยันสินค้า 1 รายการ</b><small>{p.name} ยังไม่รวมในยอด</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
        {!p && b.staff > 0 && <p className={s.staff}>พนักงานกำลังตรวจสอบรายการที่คุณปฏิเสธ…</p>}

        <div className={s.cats} role="tablist" aria-label="หมวดหมู่">
          {cats.map((c, i) => <button key={c} role="tab" aria-selected={cat === i} onClick={() => setCat(i)}>{c}</button>)}
        </div>

        <div className={s.grid}>
          {products.map((item) => {
            const q = qtyOf(item.sku);
            return (
              <article key={item.sku} className={s.card}>
                <div className={s.art} style={{ background: item.tint, color: item.ink }}>
                  <item.icon size={40} strokeWidth={1.5} aria-hidden="true" />
                  <span className={s.lane}>ชั้น {item.lane}</span>
                  {q > 0 && <span className={s.inCart}><Check size={11} aria-hidden="true" /> {q}</span>}
                </div>
                <h3>{item.name}</h3>
                <p>{item.detail}</p>
                <strong>{money(item.price)}</strong>
              </article>
            );
          })}
        </div>
        <button className={s.sim} onClick={b.simulatePick}>+ จำลองการหยิบจากชั้น</button>
      </div>

      <div className={s.dock}>
        <button className={s.cartBar} onClick={() => setSheet("cart")}>
          <span className={s.cartIcon}><ShoppingBasket size={20} aria-hidden="true" /><i>{b.count}</i></span>
          <span className={s.cartText}><small>ยอดที่ยืนยันแล้ว</small><b>{money(b.total)}</b></span>
          <span className={s.cartCta}>ดูตะกร้า <ChevronRight size={16} aria-hidden="true" /></span>
        </button>
        <nav className={s.tabs} aria-label="เมนูหลัก">
          <a aria-current="page"><House size={20} aria-hidden="true" />หน้าแรก</a>
          <a><ReceiptText size={20} aria-hidden="true" />ใบเสร็จ</a>
          <a className={s.scan}><span><ScanLine size={24} aria-hidden="true" /></span>สแกน</a>
          <a><ShoppingBasket size={20} aria-hidden="true" />ตะกร้า</a>
          <a><User size={20} aria-hidden="true" />ฉัน</a>
        </nav>
      </div>

      {sheet && (
        <div className={s.scrim} onClick={() => setSheet(null)}>
          <div className={s.sheet} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <span className={s.grab} />
            <button className={s.close} aria-label="ปิด" onClick={() => setSheet(null)}><X size={18} aria-hidden="true" /></button>
            {sheet === "confirm" && p ? (
              <>
                <div className={s.sheetArt} style={{ background: p.tint, color: p.ink }}><p.icon size={54} strokeWidth={1.4} aria-hidden="true" /></div>
                <h2>คุณหยิบ {p.name} ใช่ไหม?</h2>
                <p className={s.sheetNote}>มีตะกร้า 2 ใบอยู่ใกล้ชั้น {p.lane} ระบบจึงขอให้คุณยืนยัน · {money(p.price)}</p>
                <div className={s.sheetBtns}>
                  <button className={s.primary} onClick={() => { b.confirm(true); setSheet(null); }}>ใช่ เพิ่มลงตะกร้า</button>
                  <button className={s.ghost} onClick={() => { b.confirm(false); setSheet(null); }}>ไม่ใช่ ให้พนักงานตรวจ</button>
                </div>
              </>
            ) : b.paid ? (
              <div className={s.paid}>
                <span><Check size={30} aria-hidden="true" /></span>
                <h2>ชำระเงินสำเร็จ</h2>
                <p>{money(b.total)} · ใบเสร็จตัวอย่าง · ไม่เรียกเก็บเงินจริง</p>
                <button className={s.primary} onClick={() => { b.reset(); setSheet(null); }}>เริ่มช้อปใหม่</button>
              </div>
            ) : (
              <>
                <h2 className={s.cartTitle}>ตะกร้า A · {b.count} ชิ้น</h2>
                <ul className={s.lines}>
                  {b.lines.map((l) => { const it = bySku(l.sku); return (
                    <li key={l.sku}><span style={{ background: it.tint, color: it.ink }}><it.icon size={20} aria-hidden="true" /></span><div><b>{it.name}</b><small>{money(it.price)} × {l.qty}</small></div><strong>{money(it.price * l.qty)}</strong></li>
                  ); })}
                  {p && <li className={s.pendingLine}><span style={{ background: p.tint, color: p.ink }}><p.icon size={20} aria-hidden="true" /></span><div><b>{p.name}</b><small>รอคุณยืนยัน · ไม่รวมในยอด</small></div><strong>{money(p.price)}</strong></li>}
                </ul>
                <div className={s.totalRow}><span>ยอดชำระ</span><b>{money(b.total)}</b></div>
                {b.blockReason && <p className={s.block}>{b.blockReason}</p>}
                <button className={s.primary} disabled={!b.canPay} onClick={b.pay}>ชำระเงิน {money(b.total)}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
