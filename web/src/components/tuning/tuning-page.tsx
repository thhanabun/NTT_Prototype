"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, CircleAlert, LoaderCircle, Radio, RotateCcw, Ruler, Save, Timer } from "lucide-react";
import { getPresence, resetTuning, saveTuning } from "@/lib/api/client";
import { useLiveState } from "@/lib/api/live-state";
import type { BasketId, PositioningTuning, PresenceSnapshot } from "@/lib/api/types";
import { DEFAULT_STORE_LAYOUT, anchorPoint, metersPerUnit } from "@/lib/store-layout";
import styles from "./tuning.module.css";

const POLL_MS = 1000;
const HISTORY_MS = 60_000;
const STATS_MS = 30_000;
const BASKETS: BasketId[] = ["A", "B"];

type Sample = { t: number; rssi: number };
type History = Map<string, Sample[]>;

const linkKey = (a: string, b: string) => `link:${[a, b].sort().join("|")}`;
const basketKey = (basketId: string, shelfId: string) => `basket:${basketId}:${shelfId}`;
const short = (shelfId: string) => shelfId.replace("SHELF-", "ESP ");
const meters = (rssi: number, model: { txPower: number; n: number }) => Math.min(60, Math.max(0.1, 10 ** ((model.txPower - rssi) / (10 * model.n))));

function stats(samples: Sample[] | undefined, now: number) {
  const recent = (samples ?? []).filter((s) => now - s.t <= STATS_MS).map((s) => s.rssi);
  if (!recent.length) return null;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);
  return { mean, sd, min: Math.min(...recent), max: Math.max(...recent), count: recent.length };
}

// Noise quality from the RSSI spread over the last 30 s.
const noiseClass = (sd: number) => (sd <= 2 ? styles.good : sd <= 4 ? styles.fair : styles.poor);

function Sparkline({ samples, now }: { samples: Sample[] | undefined; now: number }) {
  const points = (samples ?? []).filter((s) => now - s.t <= HISTORY_MS);
  if (points.length < 2) return <span className={styles.sparkEmpty}>—</span>;
  const y = (rssi: number) => 22 - ((Math.min(-30, Math.max(-100, rssi)) + 100) / 70) * 20;
  const x = (t: number) => 2 + ((t - (now - HISTORY_MS)) / HISTORY_MS) * 96;
  return (
    <svg className={styles.spark} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points.map((s) => `${x(s.t).toFixed(1)},${y(s.rssi).toFixed(1)}`).join(" ")} />
    </svg>
  );
}

export function TuningPage() {
  const live = useLiveState();
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const [history, setHistory] = useState<History>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [pollError, setPollError] = useState("");
  const historyRef = useRef<History>(new Map());

  // Poll while this page is open: SSE only pushes when zones move, tuning needs every reading.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = await getPresence(AbortSignal.timeout(4000));
        if (stopped) return;
        const t = Date.now();
        const map = historyRef.current;
        const add = (key: string, rssi: number | null | undefined) => {
          if (rssi === null || rssi === undefined || !Number.isFinite(rssi)) return;
          const list = (map.get(key) ?? []).filter((s) => t - s.t <= HISTORY_MS);
          list.push({ t, rssi });
          map.set(key, list);
        };
        for (const link of next.positioning?.links ?? []) add(linkKey(link.a, link.b), link.rssi);
        for (const basket of next.baskets) for (const [shelfId, rssi] of Object.entries(basket.rssi)) add(basketKey(basket.basketId, shelfId), rssi);
        setHistory(new Map(map));
        setSnapshot(next);
        setNow(t);
        setPollError("");
      } catch (cause) {
        if (!stopped) setPollError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (!stopped) timer = setTimeout(poll, POLL_MS);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const layout = live.layout ?? DEFAULT_STORE_LAYOUT;
  const scale = metersPerUnit(layout);
  const positioning = snapshot?.positioning;
  const model = positioning?.model ?? { txPower: -59, n: 2.2, calibrated: false, samples: 0 };
  const basketModel = positioning?.basketModel ?? { txPower: model.txPower, n: model.n, source: "default" as const };
  const shelves = snapshot?.shelves ?? [];
  const anchorsM = new Map(layout.zones.filter((z) => z.kind === "shelf" && z.shelfId).map((z) => {
    const p = anchorPoint(z);
    return [z.shelfId as string, { x: p.x * scale, y: p.y * scale, label: z.label }];
  }));
  const mapDistance = (a: string, b: string) => {
    const p = anchorsM.get(a), q = anchorsM.get(b);
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : null;
  };
  const shelfIds = [...new Set([...shelves.map((s) => s.shelfId), ...anchorsM.keys()])].sort();
  const online = new Map(shelves.map((s) => [s.shelfId, s.online]));

  return (
    <div className={styles.page} lang="th">
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>BASKETLY / POSITIONING TUNING</p>
          <h1>ปรับจูนระยะ ESP32 และ BLE<span>.</span></h1>
          <p>ดูว่า ESP32 แต่ละตัวห่างกันเท่าไร และห่างจากตะกร้าเท่าไร จาก RSSI จริงทุกวินาที แล้วปรับโมเดลระยะให้ตรงกับร้าน</p>
        </div>
        <span className={styles.liveBadge}>{pollError ? <><CircleAlert size={14} aria-hidden="true" /> {pollError}</> : <><Activity size={14} aria-hidden="true" /> อัปเดตทุก 1 วินาที</>}</span>
      </div>

      <section className={styles.cards} aria-label="สรุปโมเดล">
        <article><span>ESP32 ออนไลน์</span><strong>{shelves.filter((s) => s.online).length}<small> / {shelfIds.length}</small></strong><p>{shelfIds.map((id) => `${short(id)}${online.get(id) ? " ●" : " ○"}`).join("  ")}</p></article>
        <article><span>โมเดล ESP32 ↔ ESP32</span><strong>{model.txPower}<small> dBm @1ม.</small></strong><p>n = {model.n} · {model.calibrated ? `ปรับจากผัง ${model.samples} คู่` : "ค่าเริ่มต้น"}</p></article>
        <article><span>โมเดลตะกร้า (BLE)</span><strong>{basketModel.txPower}<small> dBm @1ม.</small></strong><p>n = {basketModel.n} · {({ tuned: "ตั้งจากหน้านี้", env: "จาก env", anchors: "ประมาณจาก ESP32", default: "ค่าเริ่มต้น" })[basketModel.source]}</p></article>
        <article><span>ขนาดร้านบนผัง</span><strong>{(layout.width * scale).toFixed(1)}<small> × {(layout.height * scale).toFixed(1)} ม.</small></strong><p>แก้ได้ที่ Admin → แก้ไขแผนผังร้าน</p></article>
      </section>

      <section className={styles.card} aria-labelledby="anchor-heading">
        <div className={styles.cardHead}><div><p className={styles.eyebrow}>ESP32 ↔ ESP32</p><h2 id="anchor-heading">ระยะระหว่าง ESP32</h2></div><Radio size={22} aria-hidden="true" /></div>
        <p className={styles.muted}>เทียบระยะจากสัญญาณกับระยะบนผัง ถ้าต่างกันมาก (แถวสีส้ม) ให้เช็คตำแหน่ง ESP32 บนผัง หรือสิ่งที่บังระหว่างบอร์ด</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>คู่</th><th>RSSI</th><th>σ (30 วิ)</th><th>ต่ำสุด / สูงสุด</th><th>ระยะจากสัญญาณ</th><th>ระยะบนผัง</th><th>ต่าง</th><th>60 วิ</th></tr></thead>
            <tbody>
              {(positioning?.links ?? []).map((link) => {
                const s = stats(history.get(linkKey(link.a, link.b)), now);
                const onMap = mapDistance(link.a, link.b);
                const est = meters(link.rssi, model);
                const diff = onMap === null ? null : est - onMap;
                const off = diff !== null && Math.abs(diff) > Math.max(1.5, (onMap ?? 0) * 0.4);
                return (
                  <tr key={`${link.a}-${link.b}`} className={off ? styles.rowOff : ""}>
                    <th scope="row">{short(link.a)} ↔ {short(link.b)}</th>
                    <td>{link.rssi.toFixed(1)} dBm</td>
                    <td>{s ? <span className={noiseClass(s.sd)}>±{s.sd.toFixed(1)}</span> : "—"}</td>
                    <td>{s ? `${s.min} / ${s.max}` : "—"}</td>
                    <td><strong>{est.toFixed(2)} ม.</strong></td>
                    <td>{onMap === null ? "—" : `${onMap.toFixed(2)} ม.`}</td>
                    <td>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)} ม.`}</td>
                    <td><Sparkline samples={history.get(linkKey(link.a, link.b))} now={now} /></td>
                  </tr>
                );
              })}
              {!positioning?.links.length && <tr><td colSpan={8} className={styles.empty}>ยังไม่มี ESP32 ที่ได้ยินกัน ต้องแฟลชเฟิร์มแวร์ที่มี anchor beacon ลงอย่างน้อย 2 บอร์ด</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="basket-heading">
        <div className={styles.cardHead}><div><p className={styles.eyebrow}>ESP32 ↔ BLE</p><h2 id="basket-heading">ระยะจาก ESP32 ถึงตะกร้า</h2></div><Ruler size={22} aria-hidden="true" /></div>
        <p className={styles.muted}>&quot;ระยะจากสัญญาณ&quot; ใช้โมเดลตะกร้าด้านบน &quot;ระยะจากตำแหน่ง&quot; คือระยะจากจุดที่คำนวณได้บนผังถึง ESP32 ถ้าสองค่านี้ใกล้กัน แปลว่าตำแหน่งสอดคล้องกับสัญญาณ</p>
        {BASKETS.map((basketId) => {
          const basket = snapshot?.baskets.find((b) => b.basketId === basketId);
          const position = positioning?.positions[basketId];
          return (
            <div key={basketId} className={styles.basketBlock}>
              <h3>
                <span className={styles.basketLetter}>{basketId}</span> Basket {basketId}
                <small>{position ? `ตำแหน่ง (${position.xM.toFixed(1)}, ${position.yM.toFixed(1)}) ม. ±${position.errorM.toFixed(1)} ม. จาก ESP32 ${position.anchors} ตัว` : basket?.zone ? `ใกล้ ${basket.zone}` : "ยังไม่มีตำแหน่ง"}</small>
              </h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>ESP32</th><th>RSSI</th><th>σ (30 วิ)</th><th>ระยะจากสัญญาณ</th><th>ระยะจากตำแหน่ง</th><th>60 วิ</th></tr></thead>
                  <tbody>
                    {shelfIds.map((shelfId) => {
                      const rssi = basket?.rssi[shelfId] ?? null;
                      const key = basketKey(basketId, shelfId);
                      const s = stats(history.get(key), now);
                      const anchor = anchorsM.get(shelfId);
                      const fromPosition = position && anchor ? Math.hypot(position.xM - anchor.x, position.yM - anchor.y) : null;
                      return (
                        <tr key={shelfId} className={basket?.zone === shelfId ? styles.rowHere : ""}>
                          <th scope="row">{short(shelfId)} <small>{anchor?.label ?? ""}</small></th>
                          <td>{rssi === null ? <span className={styles.dim}>{online.get(shelfId) ? "ไม่ได้ยิน" : "ออฟไลน์"}</span> : `${rssi} dBm`}</td>
                          <td>{s ? <span className={noiseClass(s.sd)}>±{s.sd.toFixed(1)}</span> : "—"}</td>
                          <td><strong>{rssi === null ? "—" : `${meters(rssi, basketModel).toFixed(2)} ม.`}</strong></td>
                          <td>{fromPosition === null ? "—" : `${fromPosition.toFixed(2)} ม.`}</td>
                          <td><Sparkline samples={history.get(key)} now={now} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>

      <div className={styles.twoCol}>
        <Calibrator history={history} historyRef={historyRef} shelfIds={shelfIds} n={basketModel.n}
          tuning={positioning?.tuning ?? null} />
        <ManualTuning tuning={positioning?.tuning ?? null} basketModel={basketModel} model={model} />
      </div>
    </div>
  );
}

// Record a basket's RSSI at a measured distance from one ESP32, then derive RSSI@1m.
function Calibrator({ history, historyRef, shelfIds, n, tuning }: {
  history: History; historyRef: React.RefObject<History>; shelfIds: string[]; n: number; tuning: PositioningTuning | null;
}) {
  const [basketId, setBasketId] = useState<BasketId>("A");
  const [shelfId, setShelfId] = useState("");
  const [distance, setDistance] = useState(1);
  const [recording, setRecording] = useState<{ start: number; until: number } | null>(null);
  const [result, setResult] = useState<{ mean: number; sd: number; count: number; txPower: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const target = shelfId || shelfIds[0] || "";
  const key = basketKey(basketId, target);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setTick(t);
      if (t < recording.until) return;
      clearInterval(timer);
      const samples = (historyRef.current.get(key) ?? []).filter((s) => s.t >= recording.start).map((s) => s.rssi);
      setRecording(null);
      if (samples.length < 5) { setMessage(`ได้ค่าแค่ ${samples.length} ค่า ลองใหม่ (ตะกร้าต้องอยู่ในระยะที่ ${short(target)} ได้ยิน)`); return; }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
      setResult({ mean, sd, count: samples.length, txPower: Math.round((mean + 10 * n * Math.log10(distance)) * 10) / 10 });
    }, 250);
    return () => clearInterval(timer);
  }, [recording, historyRef, key, n, distance, target]);

  const seconds = recording ? Math.max(0, Math.ceil((recording.until - Math.max(tick, recording.start)) / 1000)) : 0;
  const latest = history.get(key)?.at(-1)?.rssi;

  async function apply() {
    if (!result) return;
    setBusy(true);
    setMessage("");
    try {
      await saveTuning({ basketTxPower: result.txPower, n: tuning?.n ?? null, alpha: tuning?.alpha ?? null });
      setMessage(`ตั้ง RSSI@1ม. ของตะกร้าเป็น ${result.txPower} dBm แล้ว ตำแหน่งจะคำนวณใหม่ทันที`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="calibrate-heading">
      <div className={styles.cardHead}><div><p className={styles.eyebrow}>CALIBRATE</p><h2 id="calibrate-heading">วัดค่าจริงที่ระยะที่รู้</h2></div><Timer size={22} aria-hidden="true" /></div>
      <ol className={styles.steps}>
        <li>วางตะกร้าห่างจาก ESP32 ตามระยะที่วัดด้วยตลับเมตร (แนะนำ 1 ม. ไม่มีอะไรบัง)</li>
        <li>กดเก็บค่า 15 วินาที แล้วอย่าขยับตะกร้า</li>
        <li>ถ้า σ ต่ำ (สีเขียว) กดใช้ค่านี้</li>
      </ol>
      <div className={styles.form}>
        <label><span>ตะกร้า</span>
          <select value={basketId} onChange={(e) => { setBasketId(e.target.value as BasketId); setResult(null); }}>{BASKETS.map((id) => <option key={id} value={id}>Basket {id}</option>)}</select></label>
        <label><span>ESP32</span>
          <select value={target} onChange={(e) => { setShelfId(e.target.value); setResult(null); }}>{shelfIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
        <label><span>ระยะจริง (ม.)</span>
          <input type="number" inputMode="decimal" min={0.3} max={20} step={0.1} value={distance} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) { setDistance(v); setResult(null); } }} /></label>
      </div>
      <p className={styles.muted}>RSSI ตอนนี้: <strong>{latest === undefined ? "ไม่ได้ยิน" : `${latest} dBm`}</strong></p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!target || Boolean(recording) || busy}
          onClick={() => { const start = Date.now(); setResult(null); setMessage(""); setRecording({ start, until: start + 15_000 }); setTick(start); }}>
          {recording ? <><LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> กำลังเก็บ… {seconds} วิ</> : <><Timer size={16} aria-hidden="true" /> เก็บค่า 15 วินาที</>}
        </button>
      </div>
      {result && (
        <div className={styles.result}>
          <p>เฉลี่ย <strong>{result.mean.toFixed(1)} dBm</strong> จาก {result.count} ค่า · σ <span className={noiseClass(result.sd)}>±{result.sd.toFixed(1)}</span></p>
          <p>RSSI@1ม. ที่คำนวณได้ (n = {n}): <strong>{result.txPower} dBm</strong></p>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void apply()}><Save size={16} aria-hidden="true" /> ใช้ค่านี้กับตะกร้า</button>
        </div>
      )}
      {message && <p className={styles.notice} role="status">{message}</p>}
    </section>
  );
}

function ManualTuning({ tuning, basketModel, model }: {
  tuning: PositioningTuning | null;
  basketModel: { txPower: number; n: number };
  model: { txPower: number; n: number };
}) {
  const [draft, setDraft] = useState<Record<keyof PositioningTuning, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const values = draft ?? {
    basketTxPower: tuning?.basketTxPower?.toString() ?? "",
    n: tuning?.n?.toString() ?? "",
    alpha: tuning?.alpha?.toString() ?? "",
  };
  const field = (key: keyof PositioningTuning, label: string, placeholder: string, step: number) => (
    <label><span>{label}</span>
      <input type="number" inputMode="decimal" step={step} placeholder={placeholder} value={values[key]}
        onChange={(e) => setDraft({ ...values, [key]: e.target.value })} /></label>
  );
  const parse = (value: string) => (value.trim() === "" ? null : Number(value));

  async function run(action: () => Promise<PositioningTuning>, done: string) {
    setBusy(true);
    setMessage("");
    try { await action(); setDraft(null); setMessage(done); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.card} aria-labelledby="manual-heading">
      <div className={styles.cardHead}><div><p className={styles.eyebrow}>MODEL</p><h2 id="manual-heading">ตั้งค่าโมเดลเอง</h2></div><Ruler size={22} aria-hidden="true" /></div>
      <p className={styles.muted}>เว้นว่าง = ให้ระบบคำนวณเอง ระยะ = 10^((RSSI@1ม. − RSSI) / (10 × n))</p>
      <div className={styles.form}>
        {field("basketTxPower", "RSSI@1ม. ของตะกร้า (dBm)", `อัตโนมัติ (${basketModel.txPower})`, 0.5)}
        {field("n", "n (path-loss, 1.4–4.5)", `อัตโนมัติ (${model.n})`, 0.05)}
        {field("alpha", "การกรองตำแหน่ง (0.05–1)", "อัตโนมัติ (0.35)", 0.05)}
      </div>
      <p className={styles.footnote}>n ต่ำ = สัญญาณลดช้า (ห้องโล่ง) · n สูง = ลดเร็ว (มีชั้นวางหรือคนบัง) · การกรองต่ำ = หมุดนิ่งแต่ตามช้า</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy || !draft}
          onClick={() => void run(() => saveTuning({ basketTxPower: parse(values.basketTxPower), n: parse(values.n), alpha: parse(values.alpha) }), "บันทึกค่าแล้ว")}>
          <Save size={16} aria-hidden="true" /> บันทึก
        </button>
        <button type="button" className={styles.secondary} disabled={busy}
          onClick={() => void run(resetTuning, "กลับไปใช้ค่าอัตโนมัติแล้ว")}>
          <RotateCcw size={16} aria-hidden="true" /> ใช้ค่าอัตโนมัติทั้งหมด
        </button>
      </div>
      {message && <p className={styles.notice} role="status">{message}</p>}
    </section>
  );
}
