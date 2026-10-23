"use client";

import { useState } from "react";
import { MessageSquareText, Sparkles, X } from "lucide-react";
import type { StatsResponse } from "@/lib/api/types";
import { formatBaht, formatNumber, insightFor, metricValue, sourceLabel, statsTitle } from "./stats-format";
import styles from "./stat-result.module.css";

type View = "bar" | "line" | "table" | "rank";

function niceMax(value: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

function barPath(x: number, y: number, w: number, base: number) {
  const r = Math.min(4, w / 2, base - y);
  return `M${x},${base} V${y + r} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${base} Z`;
}

function SalesChart({ response, view, title, unit }: { response: StatsResponse; view: "bar" | "line"; title: string; unit: string }) {
  const rows = response.result.rows;
  const [hover, setHover] = useState<number | null>(null);
  const W = 740, H = 280;
  const plot = { left: 64, width: 650, top: 28, height: 200 };
  const top = niceMax(Math.max(1, ...rows.map((row) => row.value)));
  const band = plot.width / rows.length;
  const x = (index: number) => plot.left + (index + 0.5) * band;
  const y = (value: number) => plot.top + plot.height * (1 - value / top);
  const base = plot.top + plot.height;
  const maxIndex = rows.reduce((best, row, index) => (row.value > rows[best].value ? index : best), 0);
  const labelEvery = Math.ceil(rows.length / 8);
  const daily = response.plan.tool === "query_daily_sales";
  const labelOf = (label: string) => (daily ? label.slice(5) : label.length > 14 ? `${label.slice(0, 13)}…` : label);
  const point = hover === null ? null : rows[hover];
  const barWidth = Math.min(56, band * 0.62);
  return (
    <figure className={styles.chart} onPointerLeave={() => setHover(null)}>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} ${view === "bar" ? "bar graph" : "line graph"} หน่วย${unit}`}>
          {[0, 0.5, 1].map((ratio) => <g key={ratio}>
            <line className={ratio === 0 ? styles.axis : styles.grid} x1={plot.left} x2={plot.left + plot.width} y1={y(top * ratio)} y2={y(top * ratio)} />
            <text className={styles.tick} x={plot.left - 10} y={y(top * ratio) + 4} textAnchor="end">{formatNumber(top * ratio)}</text>
          </g>)}
          {view === "line" && <>
            <path className={styles.area} d={`M${x(0)},${base} ${rows.map((row, index) => `L${x(index)},${y(row.value)}`).join(" ")} L${x(rows.length - 1)},${base} Z`} />
            <polyline className={styles.line} points={rows.map((row, index) => `${x(index)},${y(row.value)}`).join(" ")} />
          </>}
          {rows.map((row, index) => {
            const on = hover === index;
            return <g key={row.key}>
              <title>{row.label}: {formatNumber(row.value)} {unit}</title>
              {view === "bar"
                ? <path className={on ? styles.barOn : styles.bar} d={barPath(x(index) - barWidth / 2, y(row.value), barWidth, base)} />
                : <circle className={on ? styles.dotOn : styles.dot} cx={x(index)} cy={y(row.value)} r={on ? 6 : 4} />}
              {index % labelEvery === 0 && <text className={styles.tick} x={x(index)} y={base + 22} textAnchor="middle">{labelOf(row.label)}</text>}
              {(index === maxIndex || index === rows.length - 1) && !on && <text className={styles.valueLabel} x={x(index)} y={y(row.value) - 9} textAnchor="middle">{formatNumber(row.value)}</text>}
              <rect className={styles.hit} x={plot.left + index * band} y={plot.top - 10} width={band} height={plot.height + 70} onPointerEnter={() => setHover(index)} onPointerMove={() => setHover(index)} />
            </g>;
          })}
          {point && view === "line" && <line className={styles.cross} x1={x(hover as number)} x2={x(hover as number)} y1={plot.top} y2={base} />}
        </svg>
        {point && <div className={styles.tooltip} style={{ left: `${(x(hover as number) / W) * 100}%`, top: `${(y(point.value) / H) * 100}%` }}>
          <b>{point.label}</b>
          <span>{formatBaht(point.revenue)}</span>
          <small>{formatNumber(point.quantity)} ชิ้น · {formatNumber(point.orderCount)} orders</small>
        </div>}
      </div>
      <figcaption>{title} ({unit}) · ชี้ที่{daily ? "แต่ละวัน" : "สินค้า"}เพื่อดูรายละเอียด</figcaption>
    </figure>
  );
}

function RankList({ response }: { response: StatsResponse }) {
  const rows = response.result.rows;
  const max = Math.max(1, ...rows.map((row) => row.value));
  const totalRevenue = response.result.totals.revenue;
  return (
    <div className={styles.rank}>
      {response.plan.metric === "revenue" && totalRevenue > 0 && <div className={styles.share}>
        <span>สัดส่วนยอดเงิน</span>
        <div className={styles.shareBar} role="img" aria-label={rows.map((row) => `${row.label} ${Math.round((row.revenue / totalRevenue) * 100)}%`).join(", ")}>
          {rows.map((row, index) => <i key={row.key} className={index === 0 ? styles.shareA : styles.shareB} style={{ flexGrow: row.revenue }} />)}
        </div>
        <div className={styles.shareKey}>{rows.slice(0, 2).map((row, index) => <span key={row.key}><i className={index === 0 ? styles.shareA : styles.shareB} />{row.label} <b>{Math.round((row.revenue / totalRevenue) * 100)}%</b></span>)}</div>
      </div>}
      <ol>
        {rows.map((row, index) => <li key={row.key}>
          <span className={styles.rankNo}>{index + 1}</span>
          <div>
            <div className={styles.rankHead}><b>{row.label}</b><strong>{metricValue(response, row.value)}</strong></div>
            <span className={styles.rankTrack}><span className={index === 0 ? styles.shareA : styles.shareB} style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></span>
            <small>{formatNumber(row.quantity)} ชิ้น · {formatNumber(row.orderCount)} orders · {formatBaht(row.revenue)}</small>
          </div>
        </li>)}
      </ol>
    </div>
  );
}

function DataTable({ response, title, unit }: { response: StatsResponse; title: string; unit: string }) {
  const daily = response.plan.tool === "query_daily_sales";
  const { rows, totals } = response.result;
  return (
    <div className={styles.tableWrap} role="region" aria-label={`ข้อมูล ${title}`} tabIndex={0}>
      <table>
        <caption>{title} · {unit}</caption>
        <thead><tr><th scope="col">{daily ? "วันที่" : "สินค้า"}</th><th scope="col">ยอดเงิน (฿)</th><th scope="col">ชิ้น</th><th scope="col">Orders</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{formatNumber(row.revenue)}</td><td>{formatNumber(row.quantity)}</td><td>{formatNumber(row.orderCount)}</td></tr>)}
        </tbody>
        <tfoot><tr><th scope="row">รวมช่วงเวลา</th><td>{formatNumber(totals.revenue)}</td><td>{formatNumber(totals.quantity)}</td><td>{formatNumber(totals.orderCount)}</td></tr></tfoot>
      </table>
    </div>
  );
}

export function StatResult({ response, prompt, openedAt, onAskMore, onClose }: {
  response: StatsResponse; prompt: string; openedAt: string; onAskMore: () => void; onClose: () => void;
}) {
  const { plan, result } = response;
  const daily = plan.tool === "query_daily_sales";
  const title = statsTitle(plan);
  const unit = plan.metric === "revenue" ? "บาท" : "ชิ้น";
  const [view, setView] = useState<View>(plan.chart);
  const views: { id: View; label: string }[] = daily
    ? [{ id: "bar", label: "แท่ง" }, { id: "line", label: "เส้น" }, { id: "table", label: "ตาราง" }]
    : [{ id: "bar", label: "แท่ง" }, ...(plan.chart === "line" ? [{ id: "line" as View, label: "เส้น" }] : []), { id: "rank", label: "อันดับ" }, { id: "table", label: "ตาราง" }];
  const best = [...result.rows].sort((a, b) => b.value - a.value)[0];
  const kpis = daily
    ? [
        { label: "ยอดขายรวม", value: formatBaht(result.totals.revenue), note: `${plan.startDate} ถึง ${plan.endDate}` },
        { label: "เฉลี่ยต่อวัน", value: formatBaht(result.rows.length ? result.totals.revenue / result.rows.length : 0), note: `${result.rows.length} วัน` },
        { label: "วันที่ขายดีที่สุด", value: best ? best.label.slice(5) : "—", note: best ? metricValue(response, best.value) : "ไม่มีข้อมูล" },
        { label: "Orders", value: formatNumber(result.totals.orderCount), note: `${formatNumber(result.totals.quantity)} ชิ้น` },
      ]
    : [
        { label: "ยอดขายรวม", value: formatBaht(result.totals.revenue), note: `${plan.startDate} ถึง ${plan.endDate}` },
        { label: "อันดับ 1", value: best ? best.label : "—", note: best ? metricValue(response, best.value) : "ไม่มีข้อมูล" },
        { label: "ชิ้นที่ขายได้", value: formatNumber(result.totals.quantity), note: `${result.availableGroups} ชนิดสินค้า` },
        { label: "Orders", value: formatNumber(result.totals.orderCount), note: "ที่ชำระสำเร็จ" },
      ];
  return (
    <article className={styles.result} aria-label={`ผลลัพธ์ ${title}`}>
      <div className={styles.meta}>
        <span className={styles.chip}><Sparkles size={13} aria-hidden="true" /> ผลลัพธ์จากแชท · {openedAt} น.</span>
        <span className={`${styles.chip} ${response.source === "DEMO" ? styles.chipWarn : styles.chipOk}`}>{sourceLabel(response)}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onAskMore}><MessageSquareText size={15} aria-hidden="true" /> ถามต่อในแชท</button>
        <button type="button" className={styles.ghost} onClick={onClose}><X size={15} aria-hidden="true" /> ปิดแท็บ</button>
      </div>
      <header className={styles.head}>
        <h1>{title}</h1>
        <p>{plan.startDate} ถึง {plan.endDate} · เวลาไทย · {plan.metric === "revenue" ? "ยอดเงิน" : "จำนวนชิ้น"}</p>
      </header>
      <blockquote className={styles.prompt}><span>คุณถามว่า</span>“{prompt}”</blockquote>
      {result.empty ? <div className={styles.emptyResult}><b>ไม่มี order ที่ checkout สำเร็จในช่วงนี้</b><p>ลองเลือกชุดข้อมูลสาธิตหรือเปลี่ยนช่วงเวลา</p></div> : <>
        <section className={styles.kpis} aria-label="สรุปตัวเลข">
          {kpis.map((kpi) => <div key={kpi.label}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.note}</small></div>)}
        </section>
        <section className={styles.card} aria-label="กราฟและข้อมูล">
          <div className={styles.cardHead}>
            <h2>{daily ? "ยอดเงินรายวัน" : "อันดับสินค้า"}</h2>
            <div role="group" aria-label="รูปแบบการแสดงผล" className={styles.segment}>
              {views.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
            </div>
          </div>
          {!daily && result.availableGroups < plan.limit && <p className={styles.note}>มีสินค้าที่ขายได้ {result.availableGroups} ชนิด จึงแสดงเท่าที่มี</p>}
          {(view === "bar" || view === "line") && <SalesChart key={view} response={response} view={view} title={title} unit={unit} />}
          {view === "rank" && <RankList response={response} />}
          {view === "table" && <DataTable response={response} title={title} unit={unit} />}
          {view !== "table" && <details className={styles.tableToggle}><summary>ดูตารางข้อมูล</summary><DataTable response={response} title={title} unit={unit} /></details>}
          <p className={styles.insight}><Sparkles size={15} aria-hidden="true" /><span>{insightFor(response)}</span></p>
        </section>
      </>}
      <section className={styles.card} aria-labelledby={`trace-${response.queryId}`}>
        <div className={styles.cardHead}><h2 id={`trace-${response.queryId}`}>Laya ทำอะไรไปบ้าง</h2><code>{response.queryId} · อ่านอย่างเดียว</code></div>
        <ol className={styles.trace}>
          {Object.entries(response.model.selections).map(([key, selection]) => <li key={key}><i aria-hidden="true" /><div><b>เลือก {key.replaceAll("_", " ")}</b><code>{selection.choice} · {Math.round(selection.confidence * 100)}%</code></div></li>)}
          <li><i aria-hidden="true" /><div><b>รัน query แบบอ่านอย่างเดียว</b><code>{response.model.name} · {formatNumber(response.model.requestDurationMs)} ms · {result.rows.length} แถว</code></div></li>
        </ol>
        <details className={styles.json}><summary>ดู query plan (JSON)</summary><pre>{JSON.stringify({ plan, selections: response.model.selections, queryId: response.queryId }, null, 2)}</pre></details>
        <p className={styles.note}>สรุปเมื่อ {new Date(response.generatedAt).toLocaleString("th-TH")} · ยอดรวมครอบคลุมทั้งช่วงเวลา ไม่ใช่เฉพาะ Top N</p>
      </section>
    </article>
  );
}
