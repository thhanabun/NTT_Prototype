"use client";

import { useState } from "react";
import { ArrowRight, Check, CheckCheck, CircleAlert, Clock3, LoaderCircle, QrCode, ReceiptText, RefreshCw, ShieldCheck, ShoppingBasket, X } from "lucide-react";
import { BasketScanner } from "./basket-scanner";
import { ConnectionStatus } from "@/components/connection-status";
import { useShopper } from "./use-shopper";
import { ProductArt } from "./product-art";
import styles from "./shopper.module.css";

export const money = (amount: number) => `฿${amount.toLocaleString("th-TH")}`;
export function ShopperApp() {
  const shop = useShopper();
  const [scannerOpen, setScannerOpen] = useState(false);
  const { basket, loading, pending, stale } = shop;
  const product = shop.state?.products.find((item) => item.sku === shop.currentCase?.sku);
  const isReturn = shop.currentCase?.eventType === "PUT_BACK";
  const canCheckout = Boolean(basket.session && basket.lines.length && basket.payable && !loading && !pending && !stale);
  const reason = loading || stale ? "รอข้อมูลล่าสุดก่อนชำระเงิน" : pending ? "กำลังส่งคำขอ กรุณารอสักครู่"
    : !basket.session ? "เลือกตะกร้าเพื่อเริ่มช้อป" : basket.unresolvedCaseCount ? "รอผลยืนยันรายการก่อนชำระเงิน"
      : !basket.lines.length ? "ยังไม่มีสินค้าที่ยืนยันแล้ว" : "";
  return (
    <div className={styles.shopper} lang="th">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>SHOPPER</p><h1>ช้อปได้เลย<span>.</span></h1></div>
        <button className={styles.scanButton} disabled={loading || pending || stale} onClick={() => setScannerOpen(true)}><QrCode size={20} aria-hidden="true" /> สแกนตะกร้า</button>
      </div>
      <div className={styles.grid}>
        <div className={styles.leftColumn}>
          <section className={styles.card} aria-labelledby="basket-heading">
            <div className={styles.cardHeading}><span className={styles.iconTile}><ShoppingBasket size={23} aria-hidden="true" /></span><div><h2 id="basket-heading">{basket.session ? "ตะกร้าที่เชื่อมต่อ" : "เลือกตะกร้า"}</h2></div>{basket.session && <span className={styles.activeBadge}>เชื่อมแล้ว</span>}</div>
            <fieldset className={styles.basketPicker} disabled={loading || pending}><legend>เลือกตะกร้า</legend>{(["A", "B"] as const).map((id) => <label key={id} className={`${styles.basketOption} ${shop.basketId === id ? styles.selectedBasket : ""}`}><input type="radio" name="basket" checked={shop.basketId === id} onChange={() => shop.selectBasket(id)} /><span className={styles.basketLetter}>{id}</span><span>Basket {id}</span>{shop.basketId === id && <Check size={16} aria-hidden="true" />}</label>)}</fieldset>
            {basket.session ? <p className={styles.sessionTime}>เริ่ม {new Date(basket.session.startedAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })}</p> : <div className={styles.connectActions}><button className={styles.primaryButton} disabled={loading || pending || stale} onClick={() => void shop.beginSession()}>{pending ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <ShoppingBasket size={17} aria-hidden="true" />} เริ่มช้อป <ArrowRight size={16} aria-hidden="true" /></button></div>}
            <div className={styles.connectionRow}><div className={styles.connection}><span className={stale ? styles.offlineDot : styles.onlineDot} /><ConnectionStatus connection={shop.connection} retryAttempt={shop.retryAttempt} stale={stale} /></div>
            <button className={styles.refreshIcon} aria-label="อัปเดตตะกร้า" disabled={loading || pending} onClick={() => void shop.refresh()}><RefreshCw size={16} aria-hidden="true" /></button></div>
          </section>
          <section className={styles.card} aria-labelledby="products-heading"><div className={styles.sectionHeading}><div><h2 id="products-heading">สินค้าในร้าน</h2></div><span className={styles.smallLabel}>{shop.state?.products.length ?? 0} รายการ</span></div>
            {shop.state?.products.map((product) => <div className={styles.productRow} key={product.sku}><ProductArt sku={product.sku} /><div className={styles.productCopy}><h3>{product.name}</h3><strong>{money(product.price)} <small>/ ชิ้น</small></strong></div></div>)}
          </section>
        </div>
        <section className={`${styles.card} ${styles.cartCard}`} aria-labelledby="cart-heading" aria-busy={loading || pending}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>YOUR CART</p><h2 id="cart-heading">รายการของคุณ <span className={styles.cartBasket}>{shop.basketId}</span></h2></div><span className={styles.itemCount}>{basket.lines.reduce((sum, line) => sum + line.quantity, 0)} ชิ้น</span></div>
          {shop.error && <div className={styles.errorNotice} role="alert"><CircleAlert size={18} aria-hidden="true" /><div>{shop.error}<button disabled={loading || pending} onClick={() => void shop.refresh()}>ลองโหลดข้อมูลอีกครั้ง</button></div></div>}
          {shop.notice && <p className={styles.actionNotice} role="status">{shop.notice}</p>}
          <div className={styles.cartContents}>{loading ? <div className={styles.emptyState} role="status"><LoaderCircle className={styles.spin} size={32} aria-hidden="true" /><h3>กำลังโหลดตะกร้า</h3></div> : basket.lines.length ? <div className={styles.cartLines}>{basket.lines.map((line) => <div className={styles.cartLine} key={line.sku}><ProductArt sku={line.sku} /><div><h3>{line.name}</h3><p>{money(line.price)} / ชิ้น</p></div><span className={styles.quantity}>×{line.quantity}</span><strong>{money(line.subtotal)}</strong></div>)}</div> : <div className={styles.emptyState}><div className={styles.emptyBasket}><ShoppingBasket size={43} aria-hidden="true" /></div><h3>{stale ? "ยังโหลดข้อมูลไม่ได้" : "ตะกร้ายังว่างอยู่"}</h3><p>{basket.session ? "หยิบสินค้าที่ต้องการได้เลย" : "เลือกตะกร้าหรือสแกน QR เพื่อเริ่มช้อป"}</p></div>}</div>
          {shop.currentCase && <section className={styles.confirmPanel} aria-labelledby="confirm-heading"><div className={styles.confirmTag}><CircleAlert size={14} aria-hidden="true" /> ต้องการคำยืนยัน · {shop.waitingCases.length} รายการ</div><div className={styles.confirmProduct}><ProductArt sku={shop.currentCase.sku} /><div><h3 id="confirm-heading">คุณ{isReturn ? "คืน" : "หยิบ"} {product?.name ?? shop.currentCase.sku} ใช่ไหม?</h3></div></div><p className={styles.pendingExplanation}>{isReturn ? "รายการจะถูกนำออกหลังยืนยันเท่านั้น" : "รายการนี้ยังไม่รวมในยอดรวม"}</p><div className={styles.confirmActions}><button className={styles.yesButton} disabled={loading || pending || stale} onClick={() => void shop.confirmItem("YES")}><Check size={17} aria-hidden="true" /> ใช่, ฉัน{isReturn ? "คืน" : "หยิบ"}</button><button className={styles.noButton} disabled={loading || pending || stale} onClick={() => void shop.confirmItem("NO")}><X size={17} aria-hidden="true" /> ไม่ใช่, ให้พนักงานดู</button></div></section>}
          {shop.staffCases.length > 0 && <div className={styles.staffNotice} role="status"><Clock3 size={23} aria-hidden="true" /><div><h3>พนักงานกำลังตรวจสอบ</h3><p>{shop.staffCases.length} รายการรอผลก่อนชำระเงิน</p></div></div>}
          {shop.receipt ? <section className={styles.receipt} aria-labelledby="receipt-heading"><span className={styles.receiptCheck}><CheckCheck size={27} aria-hidden="true" /></span><p className={styles.eyebrow}>ขอบคุณที่ใช้ FAST</p><h3 id="receipt-heading">ขอบคุณที่ช้อปกับเรา</h3><p>Basket {shop.receipt.basketId} · เสร็จสิ้น</p><dl><div><dt>Order</dt><dd>{shop.receipt.orderId}</dd></div>{shop.receipt.lines.map((line) => <div key={line.sku}><dt>{line.name} ×{line.quantity}</dt><dd>{money(line.subtotal)}</dd></div>)}<div className={styles.receiptTotal}><dt>รวม</dt><dd>{money(shop.receipt.total)}</dd></div></dl><p className={styles.mockLabel}>การชำระเงินจำลอง · ไม่เรียกเก็บเงินจริง</p><button className={styles.outlineButton} disabled={loading || pending} onClick={shop.dismissReceipt}>เตรียมช้อปครั้งใหม่ <ArrowRight size={15} aria-hidden="true" /></button></section>
            : <div className={styles.checkoutArea}><div className={styles.totalRow}><span>ยอดรวม</span><strong>{!shop.state ? "—" : money(basket.total)}</strong></div><p className={styles.checkoutReason} id="checkout-reason">{reason && <><ShieldCheck size={14} aria-hidden="true" />{reason}</>}</p><button className={styles.primaryButton} disabled={!canCheckout} aria-describedby="checkout-reason" onClick={() => void shop.finishCheckout()}>{pending ? <LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> : <ReceiptText size={18} aria-hidden="true" />} ชำระเงิน <ArrowRight size={16} aria-hidden="true" /></button><p className={styles.mockLabel}>การชำระเงินจำลอง · ไม่เรียกเก็บเงินจริง</p></div>}
        </section>
      </div>
      {scannerOpen && <BasketScanner onClose={() => setScannerOpen(false)} onPair={(id, code) => { setScannerOpen(false); shop.selectBasket(id, code); void shop.beginSession(id); }} />}
    </div>
  );
}
