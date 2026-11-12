"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Expand, LoaderCircle, MessageCircle, Shrink, Sparkles, Trash2, X } from "lucide-react";
import { OPEN_CHAT_EVENT } from "@/components/floating-menu";
import { queryShopperAgent } from "@/lib/api/client";
import type { BasketId } from "@/lib/api/types";
import type { ShopperAgentResponse, ShopperSource } from "@/lib/api/shopper-agent-types";
import chat from "@/components/admin/chat-dock.module.css";
import styles from "./shopper-chat.module.css";

interface Entry { id: number; message: string; response?: ShopperAgentResponse; error?: string; }
const examples = ["สินค้ามีอะไรบ้าง ราคาเท่าไร", "ตะกร้าฉันมีอะไรบ้าง", "ทำไมยังชำระเงินไม่ได้", "คืนสินค้าอย่างไร"];
const money = (amount: number) => `฿${amount.toLocaleString("th-TH")}`;

function Source({ source }: { source: ShopperSource }) {
  return <details className={styles.source}>
    <summary>{source.title}</summary>
    {source.kind === "catalog" && <>
      <ul>{source.data.products?.map(product => <li key={product.sku}><span>{product.name}</span><strong>{money(product.price)}</strong></li>)}</ul>
      <p>{source.data.shelves?.map(shelf => `${shelf.shelfId}: ${source.data.products?.find(product => product.sku === shelf.sku)?.name ?? shelf.sku}`).join(" · ")}</p>
    </>}
    {source.kind === "basket" && <>
      <ul>{source.data.lines?.map(line => <li key={line.sku}><span>{line.name} ×{line.quantity}</span><strong>{money(line.subtotal)}</strong></li>)}</ul>
      <p className={styles.facts}><strong>รวม {money(source.data.total ?? 0)}</strong> · รอยืนยัน {source.data.pendingCount ?? 0} รายการ<br />{source.data.canCheckout ? "พร้อม mock checkout" : "ยัง checkout ไม่ได้"}</p>
    </>}
    {source.kind === "cases" && <p>รอยืนยัน {source.data.pendingCount ?? 0} รายการ<br />{source.data.items?.map(item => `${item.sku} · ${item.eventType} · ${item.requiresStaff ? "รอพนักงาน" : "ตรวจปุ่มยืนยันบนหน้าหลัก"}`).join("\n")}</p>}
    <p className={styles.answer}>{source.data.text ?? source.excerpt}</p>
    <small>{source.data.version ? `คู่มือเวอร์ชัน ${source.data.version} · ` : ""}ข้อมูลอ้างอิง ณ เวลาที่ถาม ไม่ใช่คำสั่งแก้ไขรายการ</small>
  </details>;
}

export function ShopperChat({ basketId, hasSession }: { basketId: BasketId; hasSession: boolean }) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const counter = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = () => { opener.current = document.querySelector<HTMLButtonElement>('button[aria-controls="fast-quick-menu"]'); setOpen(true); };
    window.addEventListener(OPEN_CHAT_EVENT, show);
    return () => { window.removeEventListener(OPEN_CHAT_EVENT, show); controller.current?.abort(); };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [entries, open, pending]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); opener.current?.focus(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  async function submit(prompt = message, retryId?: number) {
    const text = prompt.trim();
    if (locked.current || !text || text.length > 1000) return;
    locked.current = true; setPending(true);
    const request = new AbortController(); controller.current = request;
    const id = retryId ?? ++counter.current;
    const history = entries.filter(entry => entry.response && entry.id !== retryId).slice(-4).map(entry => entry.message);
    setEntries(current => retryId === undefined ? [...current.slice(-7), { id, message: text }] : current.map(entry => entry.id === retryId ? { id, message: text } : entry));
    setMessage("");
    try {
      const response = await queryShopperAgent(text, basketId, history, AbortSignal.any([request.signal, AbortSignal.timeout(25000)]));
      if (request.signal.aborted) return;
      setEntries(current => current.map(entry => entry.id === id ? { id, message: text, response } : entry));
    } catch (cause) {
      if (request.signal.aborted) return;
      setEntries(current => current.map(entry => entry.id === id ? { id, message: text, error: cause instanceof Error ? cause.message : "ถามผู้ช่วยไม่สำเร็จ กรุณาลองใหม่" } : entry));
    } finally {
      if (controller.current === request && !request.signal.aborted) { locked.current = false; setPending(false); controller.current = null; }
    }
  }

  function close() { setOpen(false); opener.current?.focus(); }
  function clear() { if (!locked.current) { setEntries([]); setMessage(""); input.current?.focus(); } }

  return open && <section id="shopper-chat" className={`${chat.panel} ${wide ? chat.wide : ""}`} aria-labelledby="shopper-agent-heading" lang="th">
    <header className={chat.header}>
      <button type="button" className={chat.round} aria-label={wide ? "ย่อหน้าต่างแชท" : "ขยายหน้าต่างแชท"} onClick={() => setWide(!wide)}>{wide ? <Shrink size={17} aria-hidden="true" /> : <Expand size={17} aria-hidden="true" />}</button>
      <div className={`${chat.identity} ${styles.identity}`}><span className={chat.avatar} aria-hidden="true"><MessageCircle size={18} /></span><div><h2 id="shopper-agent-heading">ผู้ช่วยช้อป FAST</h2><span>สินค้า · ตะกร้าของคุณ · วิธีใช้งาน</span></div></div>
      <button type="button" className={chat.round} aria-label="ล้างบทสนทนา" disabled={pending || !entries.length} onClick={clear}><Trash2 size={16} aria-hidden="true" /></button>
      <button type="button" className={chat.round} aria-label="ปิดแชท" onClick={close}><X size={18} aria-hidden="true" /></button>
    </header>
    <p className={styles.note}>{hasSession ? `ผูก Basket ${basketId} แล้ว · อ่านได้เฉพาะข้อมูล session นี้` : "ยังไม่ผูกตะกร้า · ถามสินค้าและวิธีใช้งานได้ เริ่ม session บนหน้าหลักเพื่อถามตะกร้าของคุณ"}</p>
    <div ref={log} className={chat.log} role="log" aria-label="ประวัติ Shopper Agent" aria-live="polite" aria-busy={pending}>
      <div className={chat.aiRow}><span className={chat.aiAvatar} aria-hidden="true"><MessageCircle size={16} /></span><p className={chat.aiBubble}>สวัสดีค่ะ ถามสินค้า วิธีคืนสินค้า หรือรายการในตะกร้าของคุณได้เลย ผู้ช่วยอ่านข้อมูลเท่านั้น การยืนยันและชำระเงินใช้ปุ่มบนหน้าหลักนะคะ</p></div>
      {entries.map(entry => <div className={chat.entry} key={entry.id}>
        <div className={chat.userRow}><p className={chat.userBubble}><span className="sr-only">คุณ: </span>{entry.message}</p><span className={chat.userAvatar} aria-hidden="true">คุณ</span></div>
        {entry.response && <div className={chat.aiRow}>
          <span className={chat.aiAvatar} aria-hidden="true"><MessageCircle size={16} /></span>
          <div className={chat.aiCol}>
            <p className={`${chat.aiBubble} ${styles.answer}`}>{entry.response.answer}</p>
            <span className={chat.aiTag}><Sparkles size={13} aria-hidden="true" />{entry.response.kind === "blocked" ? "ขอบเขตผู้ช่วย · ไม่เรียกโมเดล" : entry.response.mode === "demo" ? "สาธิต · ไม่ได้เรียก AI" : "คำตอบจากโมเดล · ตรวจแหล่งข้อมูล"}</span>
            {entry.response.sources.length > 0 && <div className={styles.sources} aria-label="แหล่งข้อมูลคำตอบ">{entry.response.sources.map(source => <Source key={source.id} source={source} />)}</div>}
          </div>
        </div>}
        {entry.error && <div className={styles.entryError}><p role="alert" className={chat.error}>{entry.error}</p><div><button type="button" className={styles.retry} disabled={pending} onClick={() => void submit(entry.message, entry.id)}>ลองคำถามนี้อีกครั้ง</button></div></div>}
      </div>)}
      {pending && <p className={chat.thinking} role="status"><LoaderCircle size={15} aria-hidden="true" />กำลังค้นข้อมูลให้คุณ…</p>}
    </div>
    <div className={chat.examples} aria-label="ตัวอย่างคำถาม Shopper">{examples.map(example => <button key={example} type="button" disabled={pending} onClick={() => void submit(example)}>{example}</button>)}</div>
    <form className={chat.form} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="shopper-agent-message" className="sr-only">คำถาม Shopper Agent</label>
      <textarea ref={input} id="shopper-agent-message" maxLength={1000} rows={2} value={message} disabled={pending} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder="เช่น ตะกร้าฉันมีอะไรบ้าง" />
      <div className={chat.formBar}><span className={chat.hint}>{message.length}/1,000 · Enter ส่ง / Shift+Enter ขึ้นบรรทัดใหม่</span><span className={chat.spacer} /><button type="submit" className={chat.send} aria-label="ส่งคำถาม Shopper" disabled={pending || !message.trim()}>{pending ? <LoaderCircle className={chat.spin} size={18} aria-hidden="true" /> : <ArrowUp size={19} aria-hidden="true" />}</button></div>
      <p className={chat.hint}>ไม่เปลี่ยน cart หรือกด checkout · ข้อมูลสินค้าไม่มีส่วนผสมและสต็อกยืนยัน</p>
    </form>
  </section>;
}
