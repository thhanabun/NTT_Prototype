"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, LoaderCircle, Send } from "lucide-react";
import { queryStatistics } from "@/lib/api/client";
import type { StatsResponse } from "@/lib/api/types";
import styles from "./stat-query.module.css";

const examples = ["ยอดขายรายวัน 1 สัปดาห์ plot เป็น bar graph", "สินค้า top 10 ตามยอดเงินย้อนหลัง 7 วัน", "สินค้า top 10 ตามจำนวนชิ้น 30 วัน เป็นตาราง"];
const number = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
type Entry = { message: string; response?: StatsResponse; error?: string };

export function StatQuery() {
  const [message, setMessage] = useState("");
  const [source, setSource] = useState<"orders" | "demo">("orders");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => { history.current?.scrollTo({ top: history.current.scrollHeight }); }, [entries]);
  const previous = entries.findLast(entry => entry.response && entry.response.source === (source === "demo" ? "DEMO" : "MOCK_CHECKOUT_ORDERS"))?.response?.plan;

  async function submit() {
    if (locked.current || !message.trim()) return;
    locked.current = true; setPending(true);
    const prompt = message.trim();
    setEntries(current => [...current.slice(-3), { message: prompt }]);
    try {
      const response = await queryStatistics(prompt, source, previous);
      setEntries(current => [...current.slice(0, -1), { message: prompt, response }]);
      setMessage("");
    } catch (error) {
      setEntries(current => [...current.slice(0, -1), { message: prompt, error: error instanceof Error ? error.message : "Query ไม่สำเร็จ กรุณาลองอีกครั้ง" }]);
    } finally { locked.current = false; setPending(false); }
  }

  return <section className={styles.panel} aria-labelledby="stat-query-heading">
    <div className={styles.heading}><div><p>STORE ANALYTICS</p><h2 id="stat-query-heading">ถามข้อมูลร้าน</h2></div><BarChart3 size={24} aria-hidden="true" /></div>

    <div className={styles.examples} aria-label="ตัวอย่างคำถาม">{examples.map(example => <button key={example} disabled={pending} type="button" onClick={() => setMessage(example)}>{example}</button>)}</div>
    <label className={styles.source}>แหล่งข้อมูล<select aria-label="แหล่งข้อมูลสถิติ" value={source} disabled={pending} onChange={event => setSource(event.target.value as "orders" | "demo")}><option value="orders">รายการชำระเงินจำลอง</option><option value="demo">ข้อมูลตัวอย่าง · 7 วัน</option></select></label>
    <div ref={history} className={styles.history} role="log" aria-label="ประวัติ Stat Query" aria-live="polite" aria-busy={pending}>
      {!entries.length && <p className={styles.empty}>อยากรู้อะไรเกี่ยวกับร้านวันนี้?</p>}
      {entries.map((entry, index) => <article className={styles.entry} key={index}>
        <p className={styles.prompt}><strong>คุณ</strong>{entry.message}</p>
        {entry.response && <StatsResult response={entry.response} />}
        {entry.error && <p className={styles.error} role="alert">{entry.error}</p>}
        {!entry.response && !entry.error && pending && <p className={styles.loading} role="status"><LoaderCircle size={16} aria-hidden="true" /> กำลังสรุปข้อมูล…</p>}
      </article>)}
    </div>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="stat-query-message">คำถามสถิติ</label>
      <div><textarea id="stat-query-message" maxLength={1000} rows={2} value={message} disabled={pending} onChange={event => setMessage(event.target.value)} placeholder="เช่น ยอดขาย 7 วันล่าสุด เป็นกราฟแท่ง" />
        <button type="submit" disabled={pending || !message.trim()}><Send size={16} aria-hidden="true" />{pending ? "กำลัง Query…" : "ส่งคำถาม"}</button></div>
    </form>
    <details className={styles.trace}><summary>รูปแบบคำถามที่รองรับ</summary><p>กราฟแท่ง / กราฟเส้น / ตาราง · Top 1–50 · ย้อนหลัง 1–366 วัน หรือระบุวันที่ YYYY-MM-DD ถึง YYYY-MM-DD</p></details>
  </section>;
}

function StatsResult({ response }: { response: StatsResponse }) {
  const { plan, result } = response;
  const daily = plan.tool === "query_daily_sales";
  const title = daily ? "ยอดขายรายวัน" : `สินค้า Top ${plan.limit}`;
  const unit = plan.metric === "revenue" ? "บาท" : "ชิ้น";
  return <div className={styles.answer}>
    <div className={styles.resultHeading}><h3>{title}</h3><span>{response.source === "DEMO" ? "ข้อมูลตัวอย่าง" : "การชำระเงินจำลอง"}</span></div>
    <p>{plan.startDate} ถึง {plan.endDate} · เวลาไทย · {plan.metric === "revenue" ? "ยอดเงิน" : "จำนวนชิ้น"} · {plan.chart}</p>
    <p className={styles.summary}>รวมช่วงเวลา ฿{number(result.totals.revenue)} · {number(result.totals.quantity)} ชิ้น · {number(result.totals.orderCount)} Orders</p>
    {result.empty ? <p className={styles.empty}>ไม่มี order ที่ checkout สำเร็จในช่วงนี้ ลองเลือกชุดข้อมูลสาธิตหรือเปลี่ยนช่วงเวลา</p> : <>
      {!daily && result.availableGroups < plan.limit && <p className={styles.note}>มีสินค้าที่ขายได้ {result.availableGroups} ชนิด จึงแสดงเท่าที่มี</p>}
      {plan.chart !== "table" && <SalesChart response={response} title={title} unit={unit} />}
    </>}
    <div className={styles.tableWrap} role="region" aria-label={`ข้อมูล ${title}`} tabIndex={0}><table><caption>{title} · {unit}</caption><thead><tr><th scope="col">{daily ? "วันที่" : "สินค้า"}</th><th scope="col">ยอดเงิน (฿)</th><th scope="col">ชิ้น</th><th scope="col">Orders</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{number(row.revenue)}</td><td>{number(row.quantity)}</td><td>{number(row.orderCount)}</td></tr>)}</tbody></table></div>
    <details className={styles.trace}><summary>รายละเอียด Query</summary><p>Model: {response.model.name} · สรุปเมื่อ {new Date(response.generatedAt).toLocaleString("th-TH")} · ยอดรวมครอบคลุมทั้งช่วงเวลา ไม่ใช่เฉพาะ Top N</p><pre>{JSON.stringify({ plan, selections: response.model.selections, queryId: response.queryId }, null, 2)}</pre></details>
  </div>;
}

function SalesChart({ response, title, unit }: { response: StatsResponse; title: string; unit: string }) {
  const { rows } = response.result;
  const max = Math.max(1, ...rows.map(row => row.value));
  const plot = { left: 65, width: 630, top: 25, height: 190 };
  const x = (index: number) => plot.left + (index + 0.5) * plot.width / rows.length;
  const y = (value: number) => plot.top + plot.height * (1 - value / max);
  return <figure className={styles.chart}>
    <svg viewBox="0 0 740 270" role="img" aria-label={`${title} ${response.plan.chart === "bar" ? "bar graph" : "line graph"} หน่วย${unit}`}>
      {[0, 0.5, 1].map(ratio => <g key={ratio}><line x1={plot.left} x2={plot.left + plot.width} y1={y(max * ratio)} y2={y(max * ratio)} stroke="#dce8ec" /><text x={plot.left - 8} y={y(max * ratio) + 4} textAnchor="end" fontSize={11} fill="#68818d">{number(max * ratio)}</text></g>)}
      {response.plan.chart === "line" && <polyline points={rows.map((row, index) => `${x(index)},${y(row.value)}`).join(" ")} fill="none" stroke="#006d5b" strokeWidth={3} />}
      {rows.map((row, index) => <g key={row.key}>
        <title>{row.label}: {number(row.value)} {unit}</title>
        {response.plan.chart === "bar" ? <rect x={x(index) - plot.width / rows.length * 0.32} y={y(row.value)} width={plot.width / rows.length * 0.64} height={plot.top + plot.height - y(row.value)} rx={2} fill="#318969" /> : <circle cx={x(index)} cy={y(row.value)} r={3} fill="#006d5b" />}
        {index % Math.ceil(rows.length / 8) === 0 && <text x={x(index)} y={239} textAnchor="middle" fontSize={11} fill="#476d7a">{response.plan.tool === "query_daily_sales" ? row.label.slice(5) : row.label.slice(0, 14)}</text>}
      </g>)}
    </svg><figcaption>{title} ({unit}) · อ่านค่าทุกรายการได้จากตาราง</figcaption>
  </figure>;
}
