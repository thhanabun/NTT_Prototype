"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Expand, LoaderCircle, MessageCircle, MoreHorizontal, Shrink, Sparkles, X } from "lucide-react";
import { OPEN_CHAT_EVENT } from "@/components/floating-menu";
import { decideStaffCase, queryStatistics } from "@/lib/api/client";
import { setTheme, toggleTheme } from "@/components/theme-toggle";
import { parseAdminCommand, type AdminCommand, type MapView } from "@/lib/admin-commands";
import { useAdmin } from "./use-admin";
import { StaffActions } from "./staff-actions";
import type { StatsPlan, StatsResponse } from "@/lib/api/types";
import { describeStats, sourceLabel, statsTabTitle } from "./stats-format";
import styles from "./chat-dock.module.css";

const examples = ["ยอดขายรายวัน 1 สัปดาห์ plot เป็น bar graph", "สินค้า top 10 ตามยอดเงินย้อนหลัง 7 วัน", "สินค้า top 10 ตามจำนวนชิ้น 30 วัน เป็นตาราง"];

export type StatEntry = { id: string; message: string; response?: StatsResponse; error?: string; command?: AdminCommand; reply?: string };

export function ChatDock({ open, onOpenChange, activeResultId, onResult, onOpenResult, onMapViewChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeResultId: string | null;
  onResult: (entry: Required<Pick<StatEntry, "id" | "message" | "response">>) => void;
  onOpenResult: (entry: Required<Pick<StatEntry, "id" | "message" | "response">>) => void;
  onMapViewChange: (view: MapView | "toggle") => void;
}) {
  const admin = useAdmin();
  const [message, setMessage] = useState("");
  const [source, setSource] = useState<"orders" | "demo">("orders");
  const [entries, setEntries] = useState<StatEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [wide, setWide] = useState(false);
  const locked = useRef(false);
  const counter = useRef(0);
  const history = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { history.current?.scrollTo({ top: history.current.scrollHeight }); }, [entries, open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  // The site-wide floating menu opens this chat.
  useEffect(() => {
    const show = () => onOpenChange(true);
    window.addEventListener(OPEN_CHAT_EVENT, show);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, show);
  }, [onOpenChange]);
  const previous: StatsPlan | undefined = entries.findLast((entry) => entry.response && entry.response.source === (source === "demo" ? "DEMO" : "MOCK_CHECKOUT_ORDERS"))?.response?.plan;

  async function submit(text = message) {
    const prompt = text.trim();
    if (locked.current || !prompt) return;
    const command = parseAdminCommand(prompt);
    if (command) {
      let reply = "พิมพ์ทีละคำสั่ง เช่น ธีมมืด / แสดง Heatmap / แสดงจุด / ดูเคสรออนุมัติ";
      if (command.kind === "theme") {
        if (command.value === "toggle") toggleTheme(); else setTheme(command.value);
        reply = `เปลี่ยนเป็นธีม${document.documentElement.dataset.theme === "night" ? "มืด" : "สว่าง"}แล้ว`;
      } else if (command.kind === "map") {
        onMapViewChange(command.value);
        reply = command.value === "toggle" ? "สลับรูปแบบแผนที่แล้ว" : command.value === "heatmap" ? "แสดง Heatmap แล้ว" : "แสดงจุดแล้ว";
      } else if (command.kind === "cases") reply = "ตรวจเคส เลือกตะกร้า แล้วกด Approve หรือ Reject ด้านล่าง";
      setEntries(current => [...current.slice(-5), { id: `stat-${++counter.current}`, message: prompt, command, reply }]);
      setMessage("");
      return;
    }
    locked.current = true; setPending(true);
    const id = `stat-${++counter.current}`;
    setEntries((current) => [...current.slice(-5), { id, message: prompt }]);
    try {
      const response = await queryStatistics(prompt, source, previous);
      setEntries((current) => current.map((entry) => entry.id === id ? { id, message: prompt, response } : entry));
      setMessage("");
      onResult({ id, message: prompt, response });
    } catch (error) {
      setEntries((current) => current.map((entry) => entry.id === id ? { id, message: prompt, error: error instanceof Error ? error.message : "Query ไม่สำเร็จ กรุณาลองอีกครั้ง" } : entry));
    } finally { locked.current = false; setPending(false); }
  }

  return <>
    {open && <section id="stat-chat" className={`${styles.panel} ${wide ? styles.wide : ""}`} aria-labelledby="stat-query-heading">
      <header className={styles.header}>
        <button type="button" className={styles.round} aria-label={wide ? "ย่อหน้าต่างแชท" : "ขยายหน้าต่างแชท"} onClick={() => setWide(!wide)}>{wide ? <Shrink size={17} aria-hidden="true" /> : <Expand size={17} aria-hidden="true" />}</button>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true"><MessageCircle size={18} /><i /></span>
          <div><h2 id="stat-query-heading">ถามข้อมูลร้าน</h2><span>Laya · ผู้ช่วยข้อมูลร้าน</span></div>
        </div>
        <button type="button" className={styles.round} aria-label="ตัวเลือกเพิ่มเติม" disabled><MoreHorizontal size={18} aria-hidden="true" /></button>
        <button type="button" className={styles.round} aria-label="ปิดแชท" onClick={() => onOpenChange(false)}><X size={18} aria-hidden="true" /></button>
      </header>
      <div ref={history} className={styles.log} role="log" aria-label="ประวัติ Stat Query" aria-live="polite" aria-busy={pending}>
        <div className={styles.aiRow}>
          <span className={styles.aiAvatar} aria-hidden="true"><MessageCircle size={16} /></span>
          <div className={styles.aiCol}>
            <p className={styles.aiBubble}>ถามยอดขาย เปลี่ยนธีม สลับแผนที่ หรือเรียกปุ่มอนุมัติเคสได้เลย</p>
            <span className={styles.aiTag}><Sparkles size={13} aria-hidden="true" /> ตอบโดย AI</span>
          </div>
        </div>
        {entries.map((entry) => <div className={styles.entry} key={entry.id}>
          <div className={styles.userRow}><p className={styles.userBubble}><span className="sr-only">คุณ: </span>{entry.message}</p><span className={styles.userAvatar} aria-hidden="true">A</span></div>
          {entry.command && <div className={styles.aiCol}>
            <span className={styles.tool}>คำสั่งหน้าจอ</span>
            <p className={styles.aiBubble}>{entry.reply}</p>
            {entry.command.kind === "cases" && (() => {
              const requestedId = entry.command.caseId;
              const cases = admin.state?.cases.filter(item => requestedId ? item.caseId === requestedId : item.status === "OPEN_STAFF") ?? [];
              return <div className={styles.caseCards}>
                {!cases.length && <p>{admin.loading || admin.stale ? "กำลังรอข้อมูลเคสล่าสุด" : requestedId ? `ไม่พบ ${requestedId} ในข้อมูลล่าสุด` : "ไม่มีเคสรอพนักงาน"}</p>}
                {cases.map(item => <article className={styles.caseCard} key={item.caseId}>
                  <strong>{item.caseId} · {item.sku} · {item.eventType}</strong><p>{item.status} · {item.reason}</p>
                  <StaffActions item={item} baskets={admin.state?.baskets ?? []} disabled={admin.loading || admin.stale || admin.pending} pending={admin.pending}
                    onDecide={(decision, target) => void admin.execute(async () => {
                      await decideStaffCase(item.caseId, decision, target);
                      return `${item.caseId} · ${decision} สำเร็จ`;
                    })} />
                </article>)}
              </div>;
            })()}
          </div>}
          {entry.response && <div className={styles.aiRow}>
            <span className={styles.aiAvatar} aria-hidden="true"><MessageCircle size={16} /></span>
            <div className={styles.aiCol}>
              <span className={styles.tool}><i aria-hidden="true" />{entry.response.plan.tool} · {Math.max(0.1, entry.response.model.requestDurationMs / 1000).toFixed(1)} วิ</span>
              <p className={styles.aiBubble}>{describeStats(entry.response)}</p>
              <button type="button" className={styles.resultCard} onClick={() => onOpenResult({ id: entry.id, message: entry.message, response: entry.response! })}>
                <span className={styles.mini} aria-hidden="true">{entry.response.result.rows.slice(0, 8).map((row, index, rows) => <i key={row.key} style={{ height: `${Math.max(12, (row.value / Math.max(1, ...rows.map((item) => item.value))) * 100)}%` }} />)}</span>
                <span className={styles.resultText}><b>{statsTabTitle(entry.response.plan)}</b><small>{sourceLabel(entry.response)}</small></span>
                <span className={styles.resultCta}>{activeResultId === entry.id ? "เปิดอยู่" : "เปิดแท็บ ↗"}</span>
              </button>
              <span className={styles.aiTag}><Sparkles size={13} aria-hidden="true" /> ตอบโดย AI</span>
            </div>
          </div>}
          {entry.error && <p className={styles.error} role="alert">{entry.error}</p>}
          {!entry.response && !entry.command && !entry.error && pending && <p className={styles.thinking} role="status"><LoaderCircle size={15} aria-hidden="true" /> กำลังอ่านคำถามและเลือกเครื่องมือ query…</p>}
        </div>)}
      </div>
      {admin.error && <p className={styles.error} role="alert">{admin.error}</p>}
      {admin.notice && <p className={styles.hint} role="status">{admin.notice}</p>}
      <div className={styles.examples} aria-label="คำสั่งหน้าจอ">{["สลับธีม", "แสดงจุด", "แสดง Heatmap", "ดูเคสรออนุมัติ"].map(command => <button key={command} type="button" disabled={pending} onClick={() => void submit(command)}>{command}</button>)}</div>
      <div className={styles.examples} aria-label="ตัวอย่างคำถาม">{examples.map((example) => <button key={example} disabled={pending} type="button" onClick={() => void submit(example)}>{example}</button>)}</div>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="stat-query-message" className="sr-only">คำถามหรือคำสั่ง Admin</label>
        <textarea ref={input} id="stat-query-message" maxLength={1000} rows={2} value={message} disabled={pending} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder="เช่น ยอดขาย 7 วันล่าสุด เป็นกราฟแท่ง" />
        <div className={styles.formBar}>
          <select aria-label="แหล่งข้อมูลสถิติ" value={source} disabled={pending} onChange={(event) => setSource(event.target.value as "orders" | "demo")}>
            <option value="orders">รายการชำระเงินจำลอง</option>
            <option value="demo">ข้อมูลตัวอย่าง · 7 วัน</option>
          </select>
          <span className={styles.spacer} />
          <button type="submit" className={styles.send} aria-label="ส่งคำถาม" disabled={pending || !message.trim()}>{pending ? <LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> : <ArrowUp size={19} aria-hidden="true" />}</button>
        </div>
        <p className={styles.hint}>กราฟแท่ง / เส้น / ตาราง · Top 1–50 · ย้อนหลัง 1–366 วัน หรือระบุ YYYY-MM-DD ถึง YYYY-MM-DD</p>
      </form>
    </section>}
  </>;
}
