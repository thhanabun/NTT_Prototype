"use client";

import { useState } from "react";
import { CircleAlert, MapPinned, Ruler, Triangle } from "lucide-react";
import { saveStoreLayout, saveTuning } from "@/lib/api/client";
import { acceptStoreLayout } from "@/lib/api/live-state";
import type { AnchorLink, PositioningTuning, StoreLayout } from "@/lib/api/types";
import { alignTo, fitScale, relativePlacement, rssiToMeters, type Point } from "@/lib/positioning";
import { anchorPoint, metersPerUnit } from "@/lib/store-layout";
import styles from "./tuning.module.css";

const VIEW = { w: 420, h: 300, pad: 36 };
const short = (shelfId: string) => shelfId.replace("SHELF-", "ESP ");
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

interface Props {
  links: AnchorLink[];
  // 30-second mean RSSI for a pair, steadier than the latest reading.
  meanRssi: (a: string, b: string) => number | null;
  layout: StoreLayout;
  tuning: PositioningTuning | null;
  responseMs: number;
  onResponseChange: (ms: number) => void;
}

const RESPONSE_OPTIONS = [{ ms: 3000, label: "เร็ว 3 วิ" }, { ms: 8000, label: "ปกติ 8 วิ" }, { ms: 30000, label: "นิ่ง 30 วิ" }];

const EMPTY_TUNING: PositioningTuning = { basketTxPower: null, anchorTxPower: null, n: null, alpha: null };

// The ESP32s measure each other's RSSI; this turns those distances into points.
export function AnchorTriangle({ links, meanRssi, layout, tuning, responseMs, onResponseChange }: Props) {
  // Blank drafts follow the saved tuning; typing previews a value without saving it.
  const [txDraft, setTxDraft] = useState("");
  const [nDraft, setNDraft] = useState("");
  const [realDistances, setRealDistances] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const savedTx = tuning?.anchorTxPower ?? -59;
  const savedN = tuning?.n ?? 2.2;
  const tx = txDraft.trim() === "" ? savedTx : Number(txDraft);
  const n = nDraft.trim() === "" ? savedN : Number(nDraft);
  const model = { txPower: Number.isFinite(tx) ? tx : savedTx, n: Number.isFinite(n) && n > 0 ? n : savedN };

  const rssiFor = new Map(links.map((link) => [pairKey(link.a, link.b), meanRssi(link.a, link.b) ?? link.rssi]));
  const measured = (a: string, b: string) => {
    const rssi = rssiFor.get(pairKey(a, b));
    return rssi === undefined ? NaN : rssiToMeters(rssi, model);
  };
  const linkCount = (id: string) => links.filter((l) => l.a === id || l.b === id).length;
  const ids = [...new Set(links.flatMap((l) => [l.a, l.b]))].sort((a, b) => linkCount(b) - linkCount(a) || a.localeCompare(b));

  // Positions on the saved map, in metres, used for orientation and comparison.
  const scale = metersPerUnit(layout);
  const mapPoints = new Map<string, Point>(layout.zones.filter((z) => z.kind === "shelf" && z.shelfId).map((z) => {
    const p = anchorPoint(z);
    return [z.shelfId as string, { x: p.x * scale, y: p.y * scale }];
  }));
  const relative = relativePlacement(ids, measured);
  const aligned = relative ? alignTo(relative, mapPoints) : null;

  // Triangle check: noisy RSSI can produce sides that cannot form a triangle.
  const broken = ids.length >= 3 && (() => {
    const [a, b, c] = ids;
    const ab = measured(a, b), ac = measured(a, c), bc = measured(b, c);
    return ab + ac < bc * 0.98 || ab + bc < ac * 0.98 || ac + bc < ab * 0.98;
  })();

  // Fit the measured points; include map points only while the measured shape stays readable.
  const measuredPts = [...(aligned?.values() ?? [])];
  const mapPts = ids.map((id) => mapPoints.get(id)).filter((p): p is Point => Boolean(p));
  const bounds = (points: Point[]) => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const own = measuredPts.length ? bounds(measuredPts) : { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const all = measuredPts.length ? bounds([...measuredPts, ...mapPts]) : own;
  const span = (b: typeof own) => Math.max(0.5, b.maxX - b.minX, b.maxY - b.minY);
  const fit = span(own) / span(all) >= 0.45 ? all : own;
  const minX = fit.minX, maxX = Math.max(fit.maxX, fit.minX + 0.5);
  const minY = fit.minY, maxY = Math.max(fit.maxY, fit.minY + 0.5);
  const k = Math.min((VIEW.w - VIEW.pad * 2) / Math.max(0.5, maxX - minX), (VIEW.h - VIEW.pad * 2) / Math.max(0.5, maxY - minY));
  const px = (p: Point) => ({ x: VIEW.pad + (p.x - minX) * k, y: VIEW.pad + (p.y - minY) * k });
  // Labels are pushed away from the centre of the shape so they do not cover each other.
  const placedPx = aligned ? ids.map((id) => aligned.get(id)).filter((p): p is Point => Boolean(p)).map(px) : [];
  const centre = placedPx.length
    ? { x: placedPx.reduce((s, p) => s + p.x, 0) / placedPx.length, y: placedPx.reduce((s, p) => s + p.y, 0) / placedPx.length }
    : { x: VIEW.w / 2, y: VIEW.h / 2 };
  const outward = (p: { x: number; y: number }, distance: number) => {
    const dx = p.x - centre.x, dy = p.y - centre.y, length = Math.hypot(dx, dy);
    return length < 1 ? { x: p.x, y: p.y - distance } : { x: p.x + (dx / length) * distance, y: p.y + (dy / length) * distance };
  };
  const gridStep = maxX - minX > 12 ? 2 : 1;
  const grid: number[] = [];
  for (let m = Math.ceil(minX); m <= maxX; m += gridStep) grid.push(m);
  const gridY: number[] = [];
  for (let m = Math.ceil(minY); m <= maxY; m += gridStep) gridY.push(m);

  // Pairs measured with a tape measure set the scale: RSSI@1m, and n when distances vary.
  const measuredPairs = links.flatMap((link) => {
    const meters = Number(realDistances[pairKey(link.a, link.b)]);
    const rssi = rssiFor.get(pairKey(link.a, link.b));
    return meters > 0 && rssi !== undefined ? [{ rssi, meters }] : [];
  });
  const scaleFit = fitScale(measuredPairs, model.n);

  async function saveScale() {
    if (!scaleFit) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveTuning({ ...EMPTY_TUNING, ...tuning, anchorTxPower: scaleFit.txPower, n: scaleFit.fittedN ? scaleFit.n : (tuning?.n ?? null) });
      setTxDraft("");
      setNDraft("");
      setMessage({ ok: true, text: `บันทึกสเกลแล้ว: RSSI@1ม. ${scaleFit.txPower} dBm${scaleFit.fittedN ? `, n ${scaleFit.n}` : ""} (จาก ${scaleFit.pairs} คู่)` });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!aligned) return;
    if (!window.confirm("ย้ายจุด ESP32 บนแผนผังร้านไปตามตำแหน่งที่วัดได้ และบันทึก?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const zones = layout.zones.map((zone) => {
        const p = zone.kind === "shelf" && zone.shelfId ? aligned.get(zone.shelfId) : undefined;
        if (!p) return zone;
        const clampTo = (value: number, max: number) => Math.round(Math.min(max, Math.max(0, value / scale)) * 10) / 10;
        return { ...zone, anchor: { x: clampTo(p.x, layout.width), y: clampTo(p.y, layout.height) } };
      });
      acceptStoreLayout(await saveStoreLayout({ width: layout.width, height: layout.height, widthM: layout.widthM ?? 12, zones }));
      setMessage({ ok: true, text: "บันทึกตำแหน่ง ESP32 บนแผนผังแล้ว ตำแหน่งตะกร้าจะคำนวณใหม่ทันที" });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="triangle-heading">
      <div className={styles.cardHead}>
        <div><p className={styles.eyebrow}>ESP32 SELF-MEASURE</p><h2 id="triangle-heading">ESP32 วัดระยะกันเอง</h2></div>
        <Triangle size={22} aria-hidden="true" />
      </div>
      <p className={styles.muted}>ESP32 แต่ละตัวฟังสัญญาณของกันและกัน แล้วแปลง RSSI (เฉลี่ยตามความไวที่เลือก) เป็นระยะ จากนั้นวางเป็น 3 จุดตามระยะที่วัดได้ หมุนให้ทิศตรงกับแผนผังร้าน วงกลมโปร่งคือตำแหน่งที่บันทึกบนผังไว้ ใช้เทียบกัน</p>

      <div className={styles.triangleLayout}>
        <div>
          {ids.length >= 2 && aligned ? (
            <svg className={styles.triangle} viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img"
              aria-label={`ตำแหน่ง ESP32 จากการวัด: ${ids.map((id) => short(id)).join(", ")}`}>
              {grid.map((m) => <line key={`x${m}`} className={styles.gridLine} x1={px({ x: m, y: 0 }).x} x2={px({ x: m, y: 0 }).x} y1={0} y2={VIEW.h} />)}
              {gridY.map((m) => <line key={`y${m}`} className={styles.gridLine} y1={px({ x: 0, y: m }).y} y2={px({ x: 0, y: m }).y} x1={0} x2={VIEW.w} />)}
              <text className={styles.gridLabel} x={VIEW.w - 6} y={VIEW.h - 6} textAnchor="end">ตาราง {gridStep} ม.</text>

              {ids.map((id) => {
                const m = aligned.get(id), map = mapPoints.get(id);
                if (!m || !map) return null;
                const a = px(m), b = px(map);
                return <g key={`map-${id}`}>
                  <line className={styles.offsetLine} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                  <circle className={styles.mapPoint} cx={b.x} cy={b.y} r="7" />
                </g>;
              })}

              {ids.flatMap((a, i) => ids.slice(i + 1).map((b) => {
                const pa = aligned.get(a), pb = aligned.get(b), d = measured(a, b);
                if (!pa || !pb || !Number.isFinite(d)) return null;
                const p = px(pa), q = px(pb), length = Math.hypot(q.x - p.x, q.y - p.y);
                // Label beside the line (perpendicular), on the side away from the shape's centre.
                const base = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                let nx = length ? -(q.y - p.y) / length : 0, ny = length ? (q.x - p.x) / length : -1;
                if ((base.x - centre.x) * nx + (base.y - centre.y) * ny < 0) { nx = -nx; ny = -ny; }
                const mid = { x: base.x + nx * 16, y: base.y + ny * 16 };
                return <g key={`edge-${a}-${b}`}>
                  <line className={styles.edge} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
                  {length >= 56 && <>
                    <rect className={styles.edgeTag} x={mid.x - 25} y={mid.y - 10} width="50" height="20" rx="6" />
                    <text className={styles.edgeLabel} x={mid.x} y={mid.y + 4} textAnchor="middle">{d.toFixed(2)} ม.</text>
                  </>}
                </g>;
              }))}

              {ids.map((id) => {
                const m = aligned.get(id);
                if (!m) return null;
                const p = px(m), label = outward(p, 22);
                return <g key={`pt-${id}`}>
                  <circle className={styles.measuredPoint} cx={p.x} cy={p.y} r="9" />
                  <text className={styles.pointLabel} x={label.x} y={label.y + 4} textAnchor="middle">{short(id)}</text>
                </g>;
              })}
            </svg>
          ) : (
            <div className={styles.triangleEmpty}>
              <CircleAlert size={20} aria-hidden="true" />
              <p>{links.length === 0
                ? "ยังไม่มี ESP32 ที่ได้ยินกัน ต้องแฟลชเฟิร์มแวร์ที่มี anchor beacon ลงอย่างน้อย 2 บอร์ด แล้วรอ 5–10 วินาที"
                : "ESP32 บางคู่ยังไม่ได้ยินกัน ต้องได้ยินกันครบทุกคู่จึงจะวางเป็นจุดได้"}</p>
            </div>
          )}
          <p className={styles.legend}>
            <span><i className={styles.legendMeasured} /> จุดจากการวัด</span>
            <span><i className={styles.legendMap} /> ตำแหน่งบนผัง</span>
            <span><i className={styles.legendEdge} /> ระยะที่วัดได้</span>
          </p>
        </div>

        <div className={styles.trianglePanel}>
          <div className={styles.segment} role="group" aria-label="ความไวการตอบสนอง">
            {RESPONSE_OPTIONS.map((option) => (
              <button key={option.ms} type="button" aria-pressed={responseMs === option.ms}
                className={responseMs === option.ms ? styles.segmentOn : ""} onClick={() => onResponseChange(option.ms)}>{option.label}</button>
            ))}
          </div>
          <div className={styles.form}>
            <label><span>RSSI@1ม. ของ ESP32</span>
              <input type="number" step={0.5} placeholder={`${savedTx}${tuning?.anchorTxPower != null ? " (บันทึกไว้)" : ""}`} value={txDraft} onChange={(e) => setTxDraft(e.target.value)} /></label>
            <label><span>n</span>
              <input type="number" step={0.05} placeholder={`${savedN}`} value={nDraft} onChange={(e) => setNDraft(e.target.value)} /></label>
          </div>
          <p className={styles.footnote}>พิมพ์เพื่อลองดูภาพก่อน (ยังไม่บันทึก) หรือใส่ &quot;ระยะจริง&quot; ที่วัดด้วยตลับเมตรในตาราง แล้วกดปรับสเกล ระบบคำนวณ RSSI@1ม. ให้ (ใส่ 2 คู่ขึ้นไปที่ระยะต่างกัน จะคำนวณ n ให้ด้วย)</p>

          <table className={styles.table}>
            <thead><tr><th>คู่</th><th>RSSI เฉลี่ย {responseMs / 1000} วิ</th><th>วัดได้</th><th>ระยะจริง (ม.)</th><th>บนผัง</th></tr></thead>
            <tbody>
              {links.map((link) => {
                const key = pairKey(link.a, link.b);
                const rssi = rssiFor.get(key)!;
                const d = rssiToMeters(rssi, model);
                const real = Number(realDistances[key]);
                const pa = mapPoints.get(link.a), pb = mapPoints.get(link.b);
                const onMap = pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : null;
                return <tr key={key}>
                  <th scope="row">{short(link.a)} ↔ {short(link.b)}</th>
                  <td>{rssi.toFixed(1)} dBm</td>
                  <td><strong>{d.toFixed(2)} ม.</strong>{real > 0 && <small className={Math.abs(d - real) <= Math.max(0.3, real * 0.15) ? styles.good : styles.fair}> ({d - real >= 0 ? "+" : ""}{(d - real).toFixed(2)})</small>}</td>
                  <td><input className={styles.cellInput} type="number" inputMode="decimal" min={0.2} max={60} step={0.05} placeholder="—"
                    aria-label={`ระยะจริง ${short(link.a)} ถึง ${short(link.b)}`} value={realDistances[key] ?? ""}
                    onChange={(e) => setRealDistances({ ...realDistances, [key]: e.target.value })} /></td>
                  <td>{onMap === null ? "—" : `${onMap.toFixed(2)} ม.`}</td>
                </tr>;
              })}
            </tbody>
          </table>
          {scaleFit && <div className={styles.result}>
            <p>จากระยะจริง {scaleFit.pairs} คู่: RSSI@1ม. = <strong>{scaleFit.txPower} dBm</strong>{scaleFit.fittedN ? <>, n = <strong>{scaleFit.n}</strong></> : ` (n = ${scaleFit.n} คงเดิม)`} · คลาดเฉลี่ย ±{scaleFit.rmsErrorM.toFixed(2)} ม.</p>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void saveScale()}>
              <Ruler size={16} aria-hidden="true" /> ปรับสเกลตามระยะจริงและบันทึก
            </button>
          </div>}
          {broken && <p className={styles.warn}>ระยะ 3 ด้านต่อกันเป็นสามเหลี่ยมไม่ได้ แปลว่าสัญญาณบางคู่ผิดเพี้ยน (มีสิ่งบัง หรือเสาอากาศหันผิดทาง) จุดที่เห็นเป็นค่าประมาณที่ใกล้ที่สุด</p>}

          <button type="button" className={styles.primary} disabled={!aligned || ids.length < 2 || busy} onClick={() => void apply()}>
            <MapPinned size={16} aria-hidden="true" /> ใช้ตำแหน่งนี้บนแผนผังร้าน
          </button>
          {message && <p className={message.ok ? styles.notice : styles.warn} role="status">{message.text}</p>}
        </div>
      </div>
    </section>
  );
}
