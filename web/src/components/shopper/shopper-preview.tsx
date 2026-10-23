"use client";

import { useState } from "react";
import {
  ArrowRight, Check, CheckCheck, ChevronRight, CircleAlert, Clock3,
  LoaderCircle, QrCode, ReceiptText, ShieldCheck, ShoppingBasket,
  Sparkles, Wifi, WifiOff, X,
} from "lucide-react";
import type { BasketId } from "@/lib/api/types";
import { ProductArt } from "./product-art";
import { previewStates, sampleBasket, sampleProducts, sampleReceipt, type PreviewState } from "./sample-data";
import styles from "./shopper.module.css";

const money = (amount: number) => `฿${amount.toLocaleString("th-TH")}`;

export function ShopperPreview() {
  const [view, setView] = useState<PreviewState>("connect");
  const [basketId, setBasketId] = useState<BasketId>("A");
  const [scannerNotice, setScannerNotice] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState(() => sampleReceipt("A"));
  const basket = sampleBasket(basketId, view);
  const isConfirmation = view === "confirm" || view === "return" || view === "multiple" || view === "remaining";
  const isLoading = view === "loading";
  const isSubmitting = view === "submitting";
  const unavailable = isLoading || view === "error" || view === "offline" || isSubmitting;
  const checkoutEnabled = Boolean(basket.session && basket.lines.length && basket.payable && !unavailable);
  const checkoutReason = isSubmitting ? "กำลังส่งคำขอ กรุณารอสักครู่"
    : view === "offline" ? "เชื่อมต่อใหม่ก่อนยืนยันยอดล่าสุด"
      : isLoading || view === "error" ? "รอโหลดข้อมูลตะกร้าให้สำเร็จ"
        : !basket.session ? "เชื่อมตะกร้าและเริ่ม session ก่อนชำระเงิน"
          : basket.unresolvedCaseCount ? "รอผลยืนยันรายการก่อนชำระเงิน"
            : !basket.lines.length ? "ยังไม่มีสินค้าที่ยืนยันแล้วในตะกร้า"
              : "ยอดรวมเฉพาะสินค้าที่ยืนยันแล้ว";

  function changeView(next: PreviewState) {
    setView(next);
    if (next === "receipt") setReceipt(sampleReceipt(basketId));
    setNotice("");
    setScannerNotice(false);
  }

  function confirmItem(answer: "YES" | "NO") {
    if (answer === "NO") {
      setView(view === "confirm" || view === "multiple" ? "staff-pending" : "staff");
      setNotice("ตัวอย่าง: ส่งรายการให้พนักงานตรวจสอบแล้ว");
    } else if (view === "multiple") {
      setView("remaining");
      setNotice("ตัวอย่าง: ยืนยันเคสแรกแล้ว เหลืออีก 1 เคสให้ตรวจสอบ");
    } else {
      setView(view === "return" ? "returned" : view === "remaining" ? "double-cart" : "cart");
      setNotice(view === "return" ? "ตัวอย่าง: ยืนยันการคืนสินค้าแล้ว" : "ตัวอย่าง: ยืนยันสินค้าแล้ว");
    }
  }

  return (
    <div className={styles.shopper} lang="th">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>FAST / UI PREVIEW</p>
          <h1>ช้อปได้เลย<span>.</span></h1>
        </div>
        <span className={styles.previewBadge}><Sparkles size={15} aria-hidden="true" /> UI preview · ข้อมูลตัวอย่าง</span>
      </div>

      <ol className={styles.steps} aria-label="ขั้นตอนการซื้อสินค้า">
        {["เชื่อมตะกร้า", "เลือกสินค้า", "ตรวจสอบและชำระ"].map((label, index) => (
          <li key={label} className={(basket.session || view === "receipt") && index === 0 ? styles.stepDone : ""}>
            <span>{(basket.session || view === "receipt") && index === 0 ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
            {label}{index < 2 && <ChevronRight size={14} aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className={styles.grid}>
        <div className={styles.leftColumn}>
          <section className={styles.card} aria-labelledby="basket-heading">
            <div className={styles.cardHeading}><span className={styles.iconTile}><ShoppingBasket size={23} aria-hidden="true" /></span>
              <div><p className={styles.eyebrow}>YOUR SMART BASKET</p><h2 id="basket-heading">{basket.session ? "เชื่อมตะกร้าแล้ว" : "เริ่มต้นที่ตะกร้าของคุณ"}</h2></div>
              {basket.session && <span className={styles.activeBadge}><Check size={12} aria-hidden="true" /> Active</span>}
            </div>
            {!basket.session && <p className={styles.muted}>สแกน QR บนตะกร้า หรือเลือกตะกร้าด้านล่างเพื่อเริ่ม shopping session</p>}
            <fieldset className={styles.basketPicker} disabled={isLoading || isSubmitting}>
              <legend>เลือกตะกร้า</legend>
              {(["A", "B"] as const).map((id) => <label key={id} className={`${styles.basketOption} ${basketId === id ? styles.selectedBasket : ""}`}>
                <input type="radio" name="basket" value={id} checked={basketId === id} onChange={() => { setBasketId(id); setNotice(""); if (view === "receipt") changeView("connect"); }} />
                <span className={styles.basketLetter}>{id}</span><span>Basket {id}</span>{basketId === id && <Check size={16} aria-hidden="true" />}
              </label>)}
            </fieldset>
            {basket.session ? <dl className={styles.sessionDetails}>
              <div><dt>Session</dt><dd>{basket.session.sessionId}</dd></div>
              <div><dt>เริ่มเมื่อ</dt><dd>10:24:15 · ข้อมูลตัวอย่าง</dd></div>
            </dl> : <div className={styles.connectActions}>
              <button className={styles.primaryButton} onClick={() => changeView("empty")}><ShoppingBasket size={18} aria-hidden="true" /> เริ่ม shopping session <ArrowRight size={16} aria-hidden="true" /></button>
              <button className={styles.outlineButton} onClick={() => setScannerNotice(true)}><QrCode size={18} aria-hidden="true" /> สแกน QR</button>
            </div>}
            {scannerNotice && <div className={styles.infoNotice} role="status">ตัวอย่างหน้าจอ QR: การเปิดกล้องและอ่าน QR จริงจะเชื่อมใน Phase 4 ตอนนี้เลือก Basket A หรือ B เพื่อทดลองได้</div>}
            <div className={styles.connection}><span className={view === "offline" ? styles.offlineDot : styles.onlineDot} />
              {view === "offline" ? "ตัวอย่าง: การเชื่อมต่อขาดหาย" : "ข้อมูลตัวอย่าง"}
            </div>
          </section>

          <section className={styles.card} aria-labelledby="products-heading">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ON THE SHELF</p><h2 id="products-heading">เลือกสิ่งที่คุณชอบ</h2></div><span className={styles.smallLabel}>2 PRODUCTS</span></div>
            {sampleProducts.map((product) => <div className={styles.productRow} key={product.sku}>
              <ProductArt sku={product.sku} /><div className={styles.productCopy}><span className={styles.productCategory}>{product.sku === "COKE" ? "REFRESH YOUR DAY" : "STAY HYDRATED"}</span>
                <h3>{product.name}</h3><p>{product.sku === "COKE" ? "Original taste · 325 ml" : "Natural water · 600 ml"}</p><strong>{money(product.price)} <small>/ {product.sku === "COKE" ? "กระป๋อง" : "ขวด"}</small></strong>
              </div><span className={styles.lane}>Lane {product.sku === "COKE" ? "01" : "02"}</span>
            </div>)}
          </section>
          <div className={styles.trustNote}><ShieldCheck size={21} aria-hidden="true" /><p><strong>ให้คุณมั่นใจก่อนจ่าย</strong><br />รายการที่ยังไม่ยืนยัน จะไม่รวมอยู่ในยอดชำระ</p></div>
        </div>

        <section className={`${styles.card} ${styles.cartCard}`} aria-labelledby="cart-heading" aria-busy={isLoading || isSubmitting}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>YOUR BASKET</p><h2 id="cart-heading">ตะกร้าสินค้า <span className={styles.cartBasket}>{basketId}</span></h2></div>
            <ShoppingBasket className={styles.cartIcon} size={27} aria-hidden="true" />
          </div>
          <div className={styles.cartContents}>
            {isLoading ? <div className={styles.emptyState} role="status"><LoaderCircle className={styles.spin} size={32} aria-hidden="true" /><h3>กำลังโหลดตะกร้า</h3><p>รอสักครู่ เรากำลังเตรียมรายการของคุณ</p></div>
              : view === "error" ? <div className={styles.emptyState} role="alert"><CircleAlert size={32} aria-hidden="true" /><h3>โหลดข้อมูลไม่สำเร็จ</h3><p>ยังยืนยันยอดล่าสุดไม่ได้ กรุณาลองอีกครั้ง</p><button className={styles.outlineButton} onClick={() => changeView("cart")}>ลองอีกครั้ง (ตัวอย่าง)</button></div>
                : basket.lines.length ? <div className={styles.cartLines}>{basket.lines.map((line) => <div className={styles.cartLine} key={line.sku}>
                  <ProductArt sku={line.sku} /><div><h3>{line.name}</h3><p>{money(line.price)} / ชิ้น <span className={styles.confirmedLabel}><Check size={11} aria-hidden="true" /> ยืนยันแล้ว</span></p></div><span className={styles.quantity}>×{line.quantity}</span><strong>{money(line.subtotal)}</strong>
                </div>)}</div>
                  : <div className={styles.emptyState}><div className={styles.emptyBasket}><ShoppingBasket size={43} strokeWidth={1.4} aria-hidden="true" /></div><h3>{view === "receipt" ? "พร้อมสำหรับครั้งต่อไป" : "ตะกร้ายังว่างอยู่"}</h3><p>{basket.session ? "หยิบสินค้าจากชั้น แล้วรายการจะปรากฏที่นี่" : "เริ่ม session เพื่อให้ตะกร้าพร้อมสำหรับการช้อป"}</p></div>}
          </div>

          {isConfirmation && <section className={styles.confirmPanel} aria-labelledby="confirm-heading">
            <div className={styles.confirmTag}><CircleAlert size={14} aria-hidden="true" /> ต้องการคำยืนยัน {view === "multiple" && "· 2 เคส"}</div>
            <div className={styles.confirmProduct}><ProductArt sku="COKE" /><div><h3 id="confirm-heading">คุณ{view === "return" ? "คืน" : "หยิบ"} Coca-Cola ใช่ไหม?</h3><p>{view === "return" ? "ระบบพบการคืนสินค้า แต่ยังระบุตะกร้าไม่ได้แน่ชัด" : "ระบบพบการหยิบสินค้า แต่ยังระบุตะกร้าไม่ได้แน่ชัด"}</p></div></div>
            <p className={styles.pendingExplanation}>{view === "return" ? "รายการจะถูกนำออกหลังยืนยันเท่านั้น" : "รายการนี้ยังไม่รวมในยอดรวม"} · Basket {basketId}</p>
            <div className={styles.confirmActions}><button className={styles.yesButton} onClick={() => confirmItem("YES")}><Check size={17} aria-hidden="true" /> ใช่, ฉัน{view === "return" ? "คืน" : "หยิบ"}</button><button className={styles.noButton} onClick={() => confirmItem("NO")}><X size={17} aria-hidden="true" /> ไม่ใช่, ให้พนักงานดู</button></div>
          </section>}

          {(view === "staff" || view === "staff-pending") && <div className={styles.staffNotice} role="status"><Clock3 size={23} aria-hidden="true" /><div><h3>พนักงานกำลังตรวจสอบ</h3><p>รายการที่ไม่แน่ชัดยังไม่รวมในยอดชำระ กรุณารอผลก่อน checkout</p><small>{view === "staff" ? "ข้อมูลตัวอย่าง: ยังไม่มีตะกร้าที่ระบุได้แน่ชัด" : `ข้อมูลตัวอย่าง: รอตรวจสอบรายการของ Basket ${basketId}`}</small></div></div>}
          {view === "offline" && <div className={styles.infoNotice} role="status"><WifiOff size={17} aria-hidden="true" /> ข้อมูลที่แสดงอาจไม่ใช่ยอดล่าสุด <button onClick={() => changeView("cart")}>เชื่อมต่อใหม่ (ตัวอย่าง)</button></div>}
          {view === "action-error" && <div className={styles.errorNotice} role="alert"><CircleAlert size={18} aria-hidden="true" /><div>คำขอไม่สำเร็จ รายการที่ยืนยันไว้ยังคงเดิม<button onClick={() => changeView("cart")}>โหลดข้อมูลล่าสุด (ตัวอย่าง)</button></div></div>}
          {notice && <p className={styles.actionNotice} role="status">{notice}</p>}

          {view === "receipt" ? <section className={styles.receipt} aria-labelledby="receipt-heading"><span className={styles.receiptCheck}><CheckCheck size={27} aria-hidden="true" /></span><p className={styles.eyebrow}>ขอบคุณที่ใช้ FAST</p><h3 id="receipt-heading">ขอบคุณที่ช้อปกับเรา</h3><p>ปิด session ของ Basket {basketId} แล้ว</p><dl><div><dt>Order</dt><dd>{receipt.orderId}</dd></div>{receipt.lines.map((line) => <div key={line.sku}><dt>{line.name} ×{line.quantity}</dt><dd>{money(line.subtotal)}</dd></div>)}<div className={styles.receiptTotal}><dt>รวม</dt><dd>{money(receipt.total)}</dd></div></dl><p className={styles.mockLabel}>ใบเสร็จตัวอย่าง · ไม่มีการเรียกเก็บเงินจริง</p><button className={styles.outlineButton} onClick={() => changeView("connect")}>เริ่มช้อปครั้งใหม่ <ArrowRight size={15} aria-hidden="true" /></button></section>
            : <div className={styles.checkoutArea}><div className={styles.summaryRow}><span>ยอดสินค้าที่ยืนยันแล้ว</span><strong>{isLoading || view === "error" ? "—" : money(basket.total)}</strong></div><div className={styles.totalRow}><span>ยอดรวม</span><strong>{isLoading || view === "error" ? "—" : money(basket.total)}</strong></div>
              <p className={styles.checkoutReason} id="checkout-reason"><ShieldCheck size={14} aria-hidden="true" />{checkoutReason}</p>
              <button className={styles.primaryButton} disabled={!checkoutEnabled} aria-describedby="checkout-reason" onClick={() => { setReceipt(sampleReceipt(basketId, basket.lines)); setView("receipt"); setNotice(""); }}>
                {isSubmitting ? <LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> : <ReceiptText size={18} aria-hidden="true" />}{isSubmitting ? "กำลังส่งคำขอ…" : "ชำระเงิน"}<ArrowRight size={17} aria-hidden="true" />
              </button><p className={styles.mockLabel}>ทดลองหน้าจอเท่านั้น · ไม่มีการเรียกเก็บเงินจริง</p>
            </div>}
          <div className={styles.cartFooter}><Wifi size={14} aria-hidden="true" /> Phase 3 · Sample data</div>
        </section>
      </div>

      <details className={styles.previewControls} open>
        <summary>Preview screen states <span>เครื่องมือทดสอบ UI</span></summary>
        <p>เลือกสถานะเพื่อดูหน้าจอตัวอย่าง ปุ่มบนหน้านี้เปลี่ยนเฉพาะ preview ไม่ส่งคำขอไป API หรือ AI</p>
        <div className={styles.stateButtons}>{previewStates.map((state) => <button key={state.id} aria-pressed={view === state.id} onClick={() => changeView(state.id)}>{state.label}</button>)}</div>
      </details>
    </div>
  );
}
