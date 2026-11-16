"use client";

import { useState } from "react";
import { ArrowRight, Check, CheckCheck, CircleAlert, Clock3, LoaderCircle, QrCode, ReceiptText, RefreshCw, ShieldCheck, ShoppingBasket, WifiOff, X, Zap } from "lucide-react";
import { ArcGauge } from "@/components/arc-gauge";
import { BasketScanner } from "./basket-scanner";
import { ConnectionStatus } from "@/components/connection-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { useShopper } from "./use-shopper";
import { ProductArt } from "./product-art";
import { getShelfProduct } from "@/lib/shelves";
import type { RssiReadings } from "@/lib/api/types";
import styles from "./shopper.module.css";

export const money = (amount: number) => `฿${amount.toLocaleString("th-TH")}`;
const signalWidth = (dbm: number) => `${Math.max(4, Math.min(100, (dbm + 100) * 1.5))}%`;

function SignalCompare({ rssi, margin }: { rssi?: RssiReadings; margin?: number }) {
  if (!rssi || (rssi.A == null && rssi.B == null)) return null;
  return (
    <div className={styles.signalCompare} aria-label="สัญญาณของตะกร้าแต่ละใบตอนเกิดเหตุ">
      {(["A", "B"] as const).map((id) => <div key={id} className={styles.signalLine}>
        <span>Basket {id}</span>
        <span className={styles.signalBar}><span style={{ width: rssi[id] == null ? "0%" : signalWidth(rssi[id] as number) }} /></span>
        <b>{rssi[id] == null ? "ไม่มีสัญญาณ" : `${rssi[id]} dBm`}</b>
      </div>)}
      {margin !== undefined && <small>สัญญาณห่างกัน {margin} dB · ใกล้กันจึงต้องให้คุณยืนยัน</small>}
    </div>
  );
}

// New design (S1-S11): one column, one main number and one main button per screen; a question takes the whole screen.
export function ShopperApp() {
  const shop = useShopper();
  const [scannerOpen, setScannerOpen] = useState(false);
  const { basket, loading, pending, stale } = shop;
  const product = shop.state?.products.find((item) => item.sku === shop.currentCase?.sku);
  const caseShelfId = shop.currentCase?.shelfId ?? shop.state?.recentEvents.find(event => event.eventId === shop.currentCase?.eventId)?.shelfId;
  const caseProduct = getShelfProduct(caseShelfId);
  const isReturn = shop.currentCase?.eventType === "PUT_BACK";
  const busy = loading || pending;
  const canCheckout = Boolean(basket.session && basket.lines.length && basket.payable && !busy && !stale);
  const reason = loading || stale ? "รอข้อมูลล่าสุดก่อนชำระเงิน" : pending ? "กำลังส่งคำขอ กรุณารอสักครู่"
    : !basket.session ? "เลือกตะกร้าเพื่อเริ่มช้อป" : basket.unresolvedCaseCount ? "รอผลยืนยันรายการก่อนชำระเงิน"
      : !basket.lines.length ? "ยังไม่มีสินค้าที่ยืนยันแล้ว" : "";
  const itemCount = basket.lines.reduce((sum, line) => sum + line.quantity, 0);
  const pendingValue = shop.waitingCases.filter((item) => item.eventType === "PICK")
    .reduce((sum, item) => sum + (shop.state?.products.find((entry) => entry.sku === item.sku)?.price ?? 0), 0);
  const gaugeNote = shop.waitingCases.length ? `${pendingValue ? `+${money(pendingValue)} ` : ""}รอยืนยัน ${shop.waitingCases.length} รายการ`
    : shop.staffCases.length ? `พนักงานกำลังตรวจ ${shop.staffCases.length} รายการ`
      : basket.lines.length ? "ทุกรายการยืนยันแล้ว" : basket.session ? "หยิบจากชั้นได้เลย รายการขึ้นเอง" : "เริ่มต้นด้วยการเลือกตะกร้า";
  const noteTone = shop.waitingCases.length ? styles.toneWarn : shop.staffCases.length ? styles.toneInfo : styles.toneOk;
  const basketPicker = <fieldset className={`${styles.basketPicker} ${basket.session ? styles.basketCompact : ""}`} disabled={busy}><legend>เลือกตะกร้า</legend>{(["A", "B"] as const).map((id) => <label key={id} className={`${styles.basketOption} ${shop.basketId === id ? styles.selectedBasket : ""}`}><input type="radio" name="basket" checked={shop.basketId === id} onChange={() => shop.selectBasket(id)} /><span className={styles.basketLetter}>{id}</span><span>Basket {id}</span>{shop.basketId === id && !basket.session && <Check size={16} aria-hidden="true" />}</label>)}</fieldset>;

  return (
    <div className={`shopper-flow ${styles.shopper} ${styles.flow}`} lang="th">
      <header className={styles.topBar}>
        <span className={styles.brand}><span className={styles.brandLogo}><Zap size={14} fill="currentColor" aria-hidden="true" /></span><span>FAST<i>.</i></span></span>
        {basket.session && basketPicker}
        <div className={styles.topTools}>
          <span className={styles.livePill}><span className={stale ? styles.offlineDot : styles.onlineDot} /><ConnectionStatus connection={shop.connection} retryAttempt={shop.retryAttempt} stale={stale} /></span>
          <button className={styles.refreshIcon} aria-label="อัปเดตตะกร้า" disabled={busy} onClick={() => void shop.refresh()}><RefreshCw size={16} aria-hidden="true" /></button>
          {basket.session && <button className={styles.refreshIcon} aria-label="สแกนตะกร้า" disabled={busy || stale} onClick={() => setScannerOpen(true)}><QrCode size={17} aria-hidden="true" /></button>}
          <ThemeToggle />
        </div>
      </header>

      {stale && !loading && <section className={styles.offline} aria-labelledby="offline-heading"><WifiOff size={26} aria-hidden="true" /><div><p className={styles.eyebrow}>OFFLINE</p><h2 id="offline-heading">การเชื่อมต่อขาดหาย</h2><p>รายการที่หยิบไว้ยังอยู่ครบ ระบบจะลองเชื่อมต่อใหม่เอง</p><button className={styles.outlineButton} disabled={busy} onClick={() => void shop.refresh()}><RefreshCw size={15} aria-hidden="true" /> ลองใหม่</button></div></section>}
      {shop.error && <div className={styles.errorNotice} role="alert"><CircleAlert size={18} aria-hidden="true" /><div>{shop.error}<button disabled={busy} onClick={() => void shop.refresh()}>ลองโหลดข้อมูลอีกครั้ง</button></div></div>}
      {shop.notice && <p className={styles.actionNotice} role="status">{shop.notice}</p>}

      {!basket.session && <section className={styles.connect} aria-labelledby="connect-heading">
        <p className={styles.eyebrow}>SHOPPER</p>
        <h1 id="connect-heading">หยิบ จ่าย<br />ไปได้เลย<span>.</span></h1>
        <p className={styles.lead}>สแกน QR บนตะกร้าเพื่อเริ่ม ระบบจะนับของที่คุณหยิบให้เอง</p>
        <button className={styles.primaryButton} disabled={busy || stale} onClick={() => setScannerOpen(true)}><QrCode size={20} aria-hidden="true" /> สแกนตะกร้า</button>
        <p className={styles.orPick}>สแกนไม่ได้? เลือกตะกร้าเอง</p>
        {basketPicker}
        <button className={styles.outlineButton} disabled={busy || stale} onClick={() => void shop.beginSession()}>{pending ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <ShoppingBasket size={17} aria-hidden="true" />} เริ่มช้อป <ArrowRight size={16} aria-hidden="true" /></button>
      </section>}

      <section className={styles.cartScreen} aria-labelledby="cart-heading" aria-busy={busy}>
        <div className={styles.sectionHeading}><h2 id="cart-heading">รายการของคุณ <span className={styles.cartBasket}>{shop.basketId}</span></h2>{basket.session && <span className={styles.activeBadge}>เชื่อมแล้ว</span>}<span className={styles.itemCount}>{itemCount} ชิ้น</span></div>
        {!shop.receipt && <div className={styles.gauge}>
          <ArcGauge confirmed={basket.total} pending={pendingValue} />
          <div className={styles.gaugeText} aria-hidden="true">
            <span className={styles.gaugeLabel}>ยืนยันแล้ว · {itemCount} ชิ้น</span>
            <strong className={styles.gaugeValue}><span>฿</span>{!shop.state ? "—" : basket.total.toLocaleString("th-TH")}</strong>
            <span className={`${styles.gaugeNote} ${noteTone}`}>{gaugeNote}</span>
          </div>
        </div>}
        {!shop.receipt && <div className={styles.cartContents}>{loading ? <div className={styles.emptyState} role="status"><LoaderCircle className={styles.spin} size={32} aria-hidden="true" /><h3>กำลังโหลดตะกร้า</h3></div> : basket.lines.length ? <div className={styles.cartLines}>{basket.lines.map((line) => <div className={styles.cartLine} key={line.sku}><ProductArt sku={line.sku} /><div><h3>{line.name}</h3><p>{money(line.price)} / ชิ้น</p></div><span className={styles.quantity}>×{line.quantity}</span><strong>{money(line.subtotal)}</strong></div>)}</div> : <div className={styles.emptyState}><div className={styles.emptyBasket}><ShoppingBasket size={36} aria-hidden="true" /></div><h3>{stale ? "ยังโหลดข้อมูลไม่ได้" : "ตะกร้ายังว่างอยู่"}</h3>{!basket.session && <p>สแกน QR หรือเลือกตะกร้าเพื่อเริ่มช้อป</p>}</div>}</div>}
        {shop.staffCases.length > 0 && <div className={styles.staffNotice} role="status"><Clock3 size={23} aria-hidden="true" /><div><h3>พนักงานกำลังตรวจสอบ</h3><p>{shop.staffCases.length} รายการรอผลก่อนชำระเงิน · รอที่ตะกร้าได้เลย</p></div></div>}
        {shop.receipt ? <section className={styles.receipt} aria-labelledby="receipt-heading"><span className={styles.receiptCheck}><CheckCheck size={27} aria-hidden="true" /></span><p className={styles.eyebrow}>เรียบร้อย</p><h3 id="receipt-heading">ขอบคุณที่ช้อปกับเรา</h3><p>Basket {shop.receipt.basketId} · วางตะกร้าคืนได้เลย</p><dl>{shop.receipt.lines.map((line) => <div key={line.sku}><dt>{line.name} ×{line.quantity}</dt><dd>{money(line.subtotal)}</dd></div>)}<div className={styles.receiptTotal}><dt>รวม</dt><dd>{money(shop.receipt.total)}</dd></div><div className={styles.orderId}><dt>Order</dt><dd>{shop.receipt.orderId}</dd></div></dl><p className={styles.mockLabel}>การชำระเงินจำลอง · ไม่เรียกเก็บเงินจริง</p><button className={styles.primaryButton} disabled={busy} onClick={shop.dismissReceipt}>เตรียมช้อปครั้งใหม่ <ArrowRight size={15} aria-hidden="true" /></button></section>
          : <div className={styles.checkoutArea}><div className={styles.totalRow}><span>ยอดรวม</span><strong>{!shop.state ? "—" : money(basket.total)}</strong></div><p className={styles.checkoutReason} id="checkout-reason">{reason && <><ShieldCheck size={14} aria-hidden="true" />{reason}</>}</p><button className={styles.primaryButton} disabled={!canCheckout} aria-describedby="checkout-reason" onClick={() => void shop.finishCheckout()}>{pending ? <LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> : <ReceiptText size={18} aria-hidden="true" />} ชำระเงิน <ArrowRight size={16} aria-hidden="true" /></button><p className={styles.mockLabel}>การชำระเงินจำลอง · ไม่เรียกเก็บเงินจริง</p></div>}
      </section>

      {shop.currentCase && <section className={styles.question} aria-labelledby="confirm-heading">
        <div className={styles.questionBody}>
          <p className={styles.confirmTag}><CircleAlert size={14} aria-hidden="true" /> คำถาม 1 จาก {shop.waitingCases.length}</p>
          <ProductArt sku={shop.currentCase.sku} variant={caseProduct?.art} />
          <h2 id="confirm-heading">คุณ{isReturn ? "คืน" : "หยิบ"} {caseProduct?.name ?? product?.name ?? shop.currentCase.sku} ใช่ไหม?</h2>
          <p className={styles.pendingExplanation}>{isReturn ? "รายการจะถูกนำออกหลังยืนยันเท่านั้น" : "ยังไม่รวมในยอดจนกว่าคุณจะตอบ"}</p>
          <SignalCompare rssi={shop.currentCase.evidence.rssi} margin={shop.currentCase.evidence.marginDb} />
        </div>
        <div className={styles.confirmActions}>
          <button className={styles.yesButton} disabled={busy || stale} onClick={() => void shop.confirmItem("YES")}><Check size={18} aria-hidden="true" /> ใช่, ฉัน{isReturn ? "คืน" : "หยิบ"}</button>
          <button className={styles.noButton} disabled={busy || stale} onClick={() => void shop.confirmItem("NO")}><X size={18} aria-hidden="true" /> ไม่ใช่, ให้พนักงานดู</button>
        </div>
      </section>}
      {scannerOpen && <BasketScanner onClose={() => setScannerOpen(false)} onPair={(id, code) => { setScannerOpen(false); shop.selectBasket(id, code); void shop.beginSession(id); }} />}
    </div>
  );
}
