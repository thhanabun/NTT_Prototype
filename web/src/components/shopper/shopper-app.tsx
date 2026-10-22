"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, CheckCheck, ChevronRight, CircleAlert, Clock3, LoaderCircle, QrCode, ReceiptText, RefreshCw, ShieldCheck, ShoppingBasket, Sparkles, X } from "lucide-react";
import { BasketScanner } from "./basket-scanner";
import { ConnectionStatus } from "@/components/connection-status";
import { useShopper } from "./use-shopper";
import { ProductArt } from "./product-art";
import { StoreMap } from "./store-map";
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
    : !basket.session ? "เริ่ม shopping session ก่อนชำระเงิน" : basket.unresolvedCaseCount ? "รอผลยืนยันรายการก่อนชำระเงิน"
      : !basket.lines.length ? "ยังไม่มีสินค้าที่ยืนยันแล้ว" : "ยอดรวมจาก backend เฉพาะสินค้าที่ยืนยันแล้ว";
  return (
    <div className={styles.shopper} lang="th">
      <div className={styles.hero}>
        <div><p className={styles.eyebrow}>BASKETLY / SHOPPER EXPERIENCE</p><h1>หยิบง่าย จ่ายสบาย<span>.</span></h1><p className={styles.heroCopy}>ตะกร้าของคุณ อัปเดตตามทุกการหยิบ พร้อมให้คุณยืนยันเมื่อระบบไม่แน่ใจ</p></div>
        <span className={styles.previewBadge}><Sparkles size={15} aria-hidden="true" /> Local demo · ข้อมูลจาก backend</span>
      </div>
      <ol className={styles.steps} aria-label="ขั้นตอนการซื้อสินค้า">
        {["เชื่อมตะกร้า", "เลือกสินค้า", "ตรวจสอบและชำระ"].map((label, index) => <li key={label} className={basket.session && index === 0 ? styles.stepDone : ""}><span>{basket.session && index === 0 ? <Check size={13} aria-hidden="true" /> : index + 1}</span>{label}{index < 2 && <ChevronRight size={14} aria-hidden="true" />}</li>)}
      </ol>
      <div className={styles.grid}>
        <div className={styles.leftColumn}>
          <section className={styles.card} aria-labelledby="basket-heading">
            <div className={styles.cardHeading}><span className={styles.iconTile}><ShoppingBasket size={23} aria-hidden="true" /></span><div><p className={styles.eyebrow}>YOUR SMART BASKET</p><h2 id="basket-heading">{basket.session ? "เชื่อมตะกร้าแล้ว" : "เริ่มต้นที่ตะกร้าของคุณ"}</h2></div>{basket.session && <span className={styles.activeBadge}>Active</span>}</div>
            <fieldset className={styles.basketPicker} disabled={loading || pending}><legend>เลือกตะกร้า</legend>{(["A", "B"] as const).map((id) => <label key={id} className={`${styles.basketOption} ${shop.basketId === id ? styles.selectedBasket : ""}`}><input type="radio" name="basket" checked={shop.basketId === id} onChange={() => shop.selectBasket(id)} /><span className={styles.basketLetter}>{id}</span><span>Basket {id}</span>{shop.basketId === id && <Check size={16} aria-hidden="true" />}</label>)}</fieldset>
            {basket.session ? <dl className={styles.sessionDetails}><div><dt>Session</dt><dd>{basket.session.sessionId}</dd></div><div><dt>เริ่มเมื่อ</dt><dd>{new Date(basket.session.startedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</dd></div></dl> : <div className={styles.connectActions}><button className={styles.primaryButton} disabled={loading || pending || stale} onClick={() => void shop.beginSession()}>{pending ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <ShoppingBasket size={17} aria-hidden="true" />} เริ่ม shopping session <ArrowRight size={16} aria-hidden="true" /></button></div>}
            <div className={styles.connection}><span className={stale ? styles.offlineDot : styles.onlineDot} /><ConnectionStatus connection={shop.connection} retryAttempt={shop.retryAttempt} stale={stale} /></div>
            <button className={`${styles.outlineButton} ${styles.refreshButton}`} disabled={loading || pending} onClick={() => void shop.refresh()}><RefreshCw size={15} aria-hidden="true" /> อัปเดตตะกร้า</button>
            <button className={`${styles.outlineButton} ${styles.refreshButton}`} disabled={loading || pending || stale} onClick={() => setScannerOpen(true)}><QrCode size={17} aria-hidden="true" /> สแกน QR</button>
          </section>
          <StoreMap presence={shop.presence} layout={shop.layout} basketId={shop.basketId} />
          <section className={styles.card} aria-labelledby="products-heading"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ON THE SHELF</p><h2 id="products-heading">เลือกสิ่งที่คุณชอบ</h2></div><span className={styles.smallLabel}>{shop.state?.products.length ?? 0} PRODUCTS</span></div>
            {shop.state?.products.map((product) => <div className={styles.productRow} key={product.sku}><ProductArt sku={product.sku} /><div className={styles.productCopy}><span className={styles.productCategory}>{product.sku === "COKE" ? "REFRESH YOUR DAY" : "STAY HYDRATED"}</span><h3>{product.name}</h3><p>{product.sku === "COKE" ? "Original taste · 325 ml" : "Natural water · 600 ml"}</p><strong>{money(product.price)} <small>/ ชิ้น</small></strong></div><span className={styles.lane}>Lane {product.sku === "COKE" ? "01" : "02"}</span></div>)}
            <p className={styles.shelfHint}><Sparkles size={15} aria-hidden="true" /> รายการสินค้าเพิ่มจาก shelf event ไม่ใช่การกดเลือกบนหน้านี้</p>
          </section>
        </div>
        <section className={`${styles.card} ${styles.cartCard}`} aria-labelledby="cart-heading" aria-busy={loading || pending}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>YOUR BASKET</p><h2 id="cart-heading">ตะกร้าสินค้า <span className={styles.cartBasket}>{shop.basketId}</span></h2></div><ShoppingBasket className={styles.cartIcon} size={27} aria-hidden="true" /></div>
          {shop.error && <div className={styles.errorNotice} role="alert"><CircleAlert size={18} aria-hidden="true" /><div>{shop.error}<button disabled={loading || pending} onClick={() => void shop.refresh()}>ลองโหลดข้อมูลอีกครั้ง</button></div></div>}
          {shop.notice && <p className={styles.actionNotice} role="status">{shop.notice}</p>}
          <div className={styles.cartContents}>{loading ? <div className={styles.emptyState} role="status"><LoaderCircle className={styles.spin} size={32} aria-hidden="true" /><h3>กำลังโหลดตะกร้า</h3></div> : basket.lines.length ? <div className={styles.cartLines}>{basket.lines.map((line) => <div className={styles.cartLine} key={line.sku}><ProductArt sku={line.sku} /><div><h3>{line.name}</h3><p>{money(line.price)} / ชิ้น <span className={styles.confirmedLabel}><Check size={11} aria-hidden="true" /> ยืนยันแล้ว</span></p></div><span className={styles.quantity}>×{line.quantity}</span><strong>{money(line.subtotal)}</strong></div>)}</div> : <div className={styles.emptyState}><div className={styles.emptyBasket}><ShoppingBasket size={43} aria-hidden="true" /></div><h3>{stale ? "ยังโหลดข้อมูลไม่ได้" : "ตะกร้ายังว่างอยู่"}</h3><p>{basket.session ? "หยิบสินค้าจากชั้น แล้วกดอัปเดตตะกร้า" : "เริ่ม session เพื่อให้ตะกร้าพร้อมสำหรับการช้อป"}</p></div>}</div>
          {shop.currentCase && <section className={styles.confirmPanel} aria-labelledby="confirm-heading"><div className={styles.confirmTag}><CircleAlert size={14} aria-hidden="true" /> ต้องการคำยืนยัน · {shop.waitingCases.length} เคส</div><div className={styles.confirmProduct}><ProductArt sku={shop.currentCase.sku} /><div><h3 id="confirm-heading">คุณ{isReturn ? "คืน" : "หยิบ"} {product?.name ?? shop.currentCase.sku} ใช่ไหม?</h3><p>ระบบพบ{isReturn ? "การคืน" : "การหยิบ"}สินค้า แต่ยังระบุตะกร้าไม่ได้แน่ชัด</p></div></div><p className={styles.pendingExplanation}>{isReturn ? "รายการจะถูกนำออกหลังยืนยันเท่านั้น" : "รายการนี้ยังไม่รวมในยอดรวม"} · {shop.currentCase.caseId}</p><div className={styles.confirmActions}><button className={styles.yesButton} disabled={loading || pending || stale} onClick={() => void shop.confirmItem("YES")}><Check size={17} aria-hidden="true" /> ใช่, ฉัน{isReturn ? "คืน" : "หยิบ"}</button><button className={styles.noButton} disabled={loading || pending || stale} onClick={() => void shop.confirmItem("NO")}><X size={17} aria-hidden="true" /> ไม่ใช่, ให้พนักงานดู</button></div></section>}
          {shop.staffCases.length > 0 && <div className={styles.staffNotice} role="status"><Clock3 size={23} aria-hidden="true" /><div><h3>พนักงานกำลังตรวจสอบ</h3><p>{shop.staffCases.length} รายการยังต้องตรวจสอบก่อน checkout สินค้าที่ค้างจะไม่เพิ่มในยอดชำระ</p></div></div>}
          {shop.receipt ? <section className={styles.receipt} aria-labelledby="receipt-heading"><span className={styles.receiptCheck}><CheckCheck size={27} aria-hidden="true" /></span><p className={styles.eyebrow}>MOCK CHECKOUT COMPLETE</p><h3 id="receipt-heading">ขอบคุณที่ช้อปกับเรา</h3><p>ปิด session ของ Basket {shop.receipt.basketId} แล้ว</p><dl><div><dt>Order</dt><dd>{shop.receipt.orderId}</dd></div>{shop.receipt.lines.map((line) => <div key={line.sku}><dt>{line.name} ×{line.quantity}</dt><dd>{money(line.subtotal)}</dd></div>)}<div className={styles.receiptTotal}><dt>รวม</dt><dd>{money(shop.receipt.total)}</dd></div></dl><p className={styles.mockLabel}>Mock order จาก local backend · ไม่มีการเรียกเก็บเงินจริง</p><button className={styles.outlineButton} disabled={loading || pending} onClick={shop.dismissReceipt}>เตรียมช้อปครั้งใหม่ <ArrowRight size={15} aria-hidden="true" /></button></section>
            : <div className={styles.checkoutArea}><div className={styles.totalRow}><span>ยอดรวม</span><strong>{!shop.state ? "—" : money(basket.total)}</strong></div><p className={styles.checkoutReason} id="checkout-reason"><ShieldCheck size={14} aria-hidden="true" />{reason}</p><button className={styles.primaryButton} disabled={!canCheckout} aria-describedby="checkout-reason" onClick={() => void shop.finishCheckout()}>{pending ? <LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> : <ReceiptText size={18} aria-hidden="true" />} Mock checkout <ArrowRight size={16} aria-hidden="true" /></button><p className={styles.mockLabel}>ไม่มีการเรียกเก็บเงินจริง</p></div>}
          <div className={styles.cartFooter}>Local demo · ไม่มีการเรียกเก็บเงินจริง</div>
        </section>
      </div>
      <div className={styles.previewControls}><Link href="/shopper/preview">ดู UI preview ด้วยข้อมูลตัวอย่าง</Link><p>เปิด <Link href="/admin" target="_blank" rel="noopener noreferrer">Admin → Local simulator</Link> เพื่อส่ง shelf event ตะกร้าจะอัปเดตอัตโนมัติเมื่อ realtime เชื่อมต่ออยู่</p></div>
      {scannerOpen && <BasketScanner onClose={() => setScannerOpen(false)} onPair={(id) => { setScannerOpen(false); shop.selectBasket(id); void shop.beginSession(id); }} />}
    </div>
  );
}
