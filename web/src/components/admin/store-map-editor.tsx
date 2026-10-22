"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { CircleAlert, Crosshair, LoaderCircle, Map as MapIcon, Plus, Radar, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import { getAutoPlace, resetStoreLayout, saveStoreLayout } from "@/lib/api/client";
import { acceptStoreLayout, useLiveState } from "@/lib/api/live-state";
import type { StoreLayout, StoreZone, StoreZoneKind } from "@/lib/api/types";
import { DEFAULT_STORE_LAYOUT, LAYOUT_MAX_ZONES, LAYOUT_MIN_SIZE, anchorPoint, metersPerUnit } from "@/lib/store-layout";
import { StoreMapCanvas, type ZoneGrab } from "@/components/store-map/store-map-canvas";
import admin from "./admin.module.css";
import styles from "./store-map-editor.module.css";

const SNAP = 2;
const kindLabel: Record<StoreZoneKind, string> = { shelf: "ชั้นวาง", cashier: "แคชเชียร์", entrance: "ทางเข้า" };

const plain = (layout: StoreLayout): StoreLayout => ({ width: layout.width, height: layout.height, widthM: layout.widthM ?? 12, zones: layout.zones });
const clampPoint = (point: { x: number; y: number }, layout: StoreLayout) => ({
  x: Math.round(Math.min(layout.width, Math.max(0, point.x)) * 10) / 10,
  y: Math.round(Math.min(layout.height, Math.max(0, point.y)) * 10) / 10,
});
const same = (a: StoreLayout, b: StoreLayout) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

// Keeps a zone on the floor and at least the minimum size.
function fit(zone: StoreZone, layout: StoreLayout): StoreZone {
  const w = Math.min(layout.width, Math.max(LAYOUT_MIN_SIZE, Math.round(zone.w)));
  const h = Math.min(layout.height, Math.max(LAYOUT_MIN_SIZE, Math.round(zone.h)));
  return {
    ...zone, w, h,
    x: Math.min(layout.width - w, Math.max(0, Math.round(zone.x))),
    y: Math.min(layout.height - h, Math.max(0, Math.round(zone.y))),
  };
}

interface Drag { id: string; grab: ZoneGrab; start: { x: number; y: number }; origin: StoreZone; originAnchor: { x: number; y: number } }

export function StoreMapEditor() {
  const live = useLiveState();
  const server = live.layout ?? DEFAULT_STORE_LAYOUT;
  const [draft, setDraft] = useState<StoreLayout | null>(null);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  const plan = draft ?? server;
  const dirty = draft !== null && !same(draft, server);
  const changedElsewhere = dirty && baseUpdatedAt !== undefined && server.updatedAt !== baseUpdatedAt;
  const selected = plan.zones.find((zone) => zone.id === selectedId) ?? null;
  const reportedShelves = live.presence?.shelves.map((shelf) => shelf.shelfId) ?? [];
  const unplaced = reportedShelves.filter((id) => !plan.zones.some((zone) => zone.shelfId === id));

  function edit(change: (layout: StoreLayout) => StoreLayout) {
    setNotice("");
    setError("");
    if (draft === null) setBaseUpdatedAt(server.updatedAt ?? null);
    setDraft(change(structuredClone(plan)));
  }
  function updateZone(id: string, patch: Partial<StoreZone>) {
    edit((layout) => ({ ...layout, zones: layout.zones.map((zone) => zone.id === id ? fit({ ...zone, ...patch }, layout) : zone) }));
  }
  // null puts the ESP32 back at the shelf centre.
  function updateAnchor(id: string, point: { x: number; y: number } | null) {
    edit((layout) => ({ ...layout, zones: layout.zones.map((zone) => {
      if (zone.id !== id) return zone;
      if (point) return { ...zone, anchor: clampPoint(point, layout) };
      const rest = { ...zone };
      delete rest.anchor;
      return rest;
    }) }));
  }

  const scale = metersPerUnit(plan);
  const toM = (units: number) => Math.round(units * scale * 100) / 100;
  const links = live.presence?.positioning?.links ?? [];
  const model = live.presence?.positioning?.model;
  const mapMeters = (a: string, b: string) => {
    const za = plan.zones.find((zone) => zone.shelfId === a), zb = plan.zones.find((zone) => zone.shelfId === b);
    if (!za || !zb) return null;
    const pa = anchorPoint(za), pb = anchorPoint(zb);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y) * scale;
  };

  async function autoPlace() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const proposal = await getAutoPlace();
      if (!proposal.anchors) { setError(proposal.reason ?? "ยังวางตำแหน่งอัตโนมัติไม่ได้"); return; }
      const placed = proposal.anchors;
      edit((layout) => ({ ...layout, zones: layout.zones.map((zone) =>
        zone.kind === "shelf" && zone.shelfId && placed[zone.shelfId] ? { ...zone, anchor: clampPoint(placed[zone.shelfId], layout) } : zone) }));
      setNotice(`วาง ESP32 ${Object.keys(placed).length} ตัวจากระยะที่วัดกันเองแล้ว ตรวจดูบนผัง ปรับได้ แล้วกดบันทึก`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ขอตำแหน่งอัตโนมัติไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  function addZone(kind: StoreZoneKind, shelfId?: string) {
    if (plan.zones.length >= LAYOUT_MAX_ZONES) return;
    const used = new Set(plan.zones.map((zone) => zone.shelfId));
    let n = 1;
    while (used.has(`SHELF-${String(n).padStart(2, "0")}`)) n += 1;
    const id = shelfId ?? `SHELF-${String(n).padStart(2, "0")}`;
    let zoneId = kind === "shelf" ? id.toLowerCase() : kind;
    for (let i = 2; plan.zones.some((zone) => zone.id === zoneId); i += 1) zoneId = `${kind === "shelf" ? id.toLowerCase() : kind}-${i}`;
    const zone: StoreZone = fit({
      id: zoneId, kind,
      label: kind === "shelf" ? `ชั้นวาง ${id.replace("SHELF-", "")}` : kindLabel[kind],
      ...(kind === "shelf" ? { shelfId: id } : {}),
      x: plan.width / 2 - 56, y: plan.height / 2 - 16, w: 112, h: kind === "entrance" ? 20 : 32,
    }, plan);
    edit((layout) => ({ ...layout, zones: [...layout.zones, zone] }));
    setSelectedId(zone.id);
  }

  function removeSelected() {
    if (!selected || plan.zones.length <= 1) return;
    edit((layout) => ({ ...layout, zones: layout.zones.filter((zone) => zone.id !== selected.id) }));
    setSelectedId(null);
  }

  function toCanvas(event: { clientX: number; clientY: number }) {
    const matrix = svgRef.current?.getScreenCTM()?.inverse();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }

  function startDrag(event: PointerEvent<SVGElement>, zone: StoreZone, grab: ZoneGrab) {
    if (event.button !== 0) return;
    event.preventDefault();
    setSelectedId(zone.id);
    svgRef.current?.focus({ preventScroll: true });
    drag.current = { id: zone.id, grab, start: toCanvas(event), origin: zone, originAnchor: anchorPoint(zone) };
    const move = (moveEvent: globalThis.PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const point = toCanvas(moveEvent);
      const dx = snap(point.x - active.start.x);
      const dy = snap(point.y - active.start.y);
      if (active.grab === "anchor") {
        updateAnchor(active.id, { x: active.originAnchor.x + dx, y: active.originAnchor.y + dy });
        return;
      }
      updateZone(active.id, active.grab === "move"
        ? { x: active.origin.x + dx, y: active.origin.y + dy }
        : { w: active.origin.w + dx, h: active.origin.h + dy });
    };
    const end = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!selected) return;
    const step = event.shiftKey ? 10 : SNAP;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      updateZone(selected.id, event.altKey ? { w: selected.w + dx, h: selected.h + dy } : { x: selected.x + dx, y: selected.y + dy });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    } else if (event.key === "Escape") {
      setSelectedId(null);
    }
  }

  async function run(action: () => Promise<StoreLayout>, message: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      acceptStoreLayout(await action());
      setDraft(null);
      setBaseUpdatedAt(undefined);
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกผังร้านไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const numberField = (key: "x" | "y" | "w" | "h", label: string) => selected && (
    <label className={styles.field}>
      <span>{label}</span>
      <input type="number" inputMode="numeric" value={selected[key]} step={SNAP}
        onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateZone(selected.id, { [key]: value }); }} />
    </label>
  );

  return (
    <section className={admin.card} aria-labelledby="map-editor-heading">
      <div className={admin.sectionHeading}>
        <div><p className={admin.eyebrow}>STORE MAP EDITOR</p><h2 id="map-editor-heading">แก้ไขแผนผังร้าน</h2></div>
        <MapIcon size={23} aria-hidden="true" />
      </div>
      <p className={admin.muted}>ลากเพื่อย้าย ลากมุมขวาล่างเพื่อปรับขนาด หรือเลือกโซนแล้วใช้ลูกศร (Shift = ทีละ 10, Alt = ปรับขนาด) บันทึกแล้วทุกหน้าจอ Shopper จะเห็นผังใหม่ทันที</p>

      {error && <div className={admin.error} role="alert"><CircleAlert size={18} aria-hidden="true" /><div>{error}</div></div>}
      {notice && <p className={admin.notice} role="status">{notice}</p>}
      {changedElsewhere && <p className={styles.warning} role="status">มีการบันทึกผังร้านจากที่อื่นระหว่างที่คุณแก้ ถ้าบันทึก จะเขียนทับผังนั้น</p>}

      <div className={styles.layout}>
        <div className={styles.canvasWrap}>
          <StoreMapCanvas layout={plan} presence={live.presence} basketId={null} editable selectedZoneId={selectedId}
            svgRef={svgRef} label="แผนผังร้านที่แก้ไขได้" onZonePointerDown={startDrag}
            onCanvasPointerDown={() => setSelectedId(null)} onKeyDown={onKeyDown} />
          <div className={styles.toolbar}>
            <button type="button" className={admin.outlineButton} disabled={saving || plan.zones.length >= LAYOUT_MAX_ZONES} onClick={() => addZone("shelf")}><Plus size={15} aria-hidden="true" /> ชั้นวาง</button>
            <button type="button" className={admin.outlineButton} disabled={saving || plan.zones.length >= LAYOUT_MAX_ZONES} onClick={() => addZone("cashier")}><Plus size={15} aria-hidden="true" /> แคชเชียร์</button>
            <button type="button" className={admin.outlineButton} disabled={saving || plan.zones.length >= LAYOUT_MAX_ZONES} onClick={() => addZone("entrance")}><Plus size={15} aria-hidden="true" /> ทางเข้า</button>
            <label className={styles.inlineField}><span>ความกว้างร้านจริง</span>
              <input type="number" inputMode="decimal" min={1} max={200} step={0.1} value={plan.widthM ?? 12}
                onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) edit((layout) => ({ ...layout, widthM: Math.min(200, value) })); }} />
              <span>ม. (สูง ≈ {toM(plan.height).toFixed(1)} ม.)</span>
            </label>
          </div>

          <section className={styles.positioning} aria-labelledby="positioning-heading">
            <div className={styles.positioningHead}>
              <h3 id="positioning-heading"><Radar size={16} aria-hidden="true" /> ตำแหน่ง ESP32 (indoor positioning)</h3>
              <button type="button" className={admin.outlineButton} disabled={saving || links.length < 3} onClick={() => void autoPlace()}>
                <Crosshair size={15} aria-hidden="true" /> ให้ ESP32 วางตำแหน่งเอง
              </button>
            </div>
            <p className={admin.footnote}>จุดสีม่วงคือ ESP32 ลากให้ตรงกับที่ติดจริง หรือพิมพ์เป็นเมตรด้านขวา ปุ่มวางเองใช้ RSSI ที่ ESP32 วัดกันเอง (แม่นประมาณ ±1–2 ม.) วัดด้วยตลับเมตรจะแม่นกว่า</p>
            {links.length ? (
              <table className={styles.linkTable}>
                <thead><tr><th>คู่ ESP32</th><th>RSSI</th><th>ระยะจากสัญญาณ</th><th>ระยะบนผัง</th></tr></thead>
                <tbody>{links.map((link) => {
                  const onMap = mapMeters(link.a, link.b);
                  const off = onMap !== null && Math.abs(link.rssiMeters - onMap) > Math.max(1.5, onMap * 0.4);
                  return <tr key={`${link.a}-${link.b}`} className={off ? styles.linkOff : ""}>
                    <td>{link.a.replace("SHELF-", "S")} ↔ {link.b.replace("SHELF-", "S")}</td><td>{link.rssi} dBm</td>
                    <td>{link.rssiMeters.toFixed(1)} ม.</td><td>{onMap === null ? "—" : `${onMap.toFixed(1)} ม.`}</td>
                  </tr>;
                })}</tbody>
              </table>
            ) : <p className={admin.muted}>ยังไม่มีข้อมูล ESP32 ได้ยินกัน ต้องแฟลชเฟิร์มแวร์ที่มี anchor beacon และเปิด ESP32 อย่างน้อย 2 ตัว</p>}
            {model && <p className={admin.footnote}>
              โมเดลระยะ: RSSI ที่ 1 ม. = {model.txPower} dBm, n = {model.n} {model.calibrated ? `(ปรับจากผัง ${model.samples} คู่)` : "(ค่าเริ่มต้น ยังไม่ได้ปรับ)"} · ระยะบนผังใช้ตำแหน่งที่บันทึกแล้ว
            </p>}
          </section>
          {unplaced.length > 0 && <p className={styles.unplaced}>
            ชั้นวางที่ออนไลน์แต่ยังไม่อยู่บนผัง:{" "}
            {unplaced.map((id) => <button key={id} type="button" disabled={saving} onClick={() => addZone("shelf", id)}>+ {id}</button>)}
          </p>}
        </div>

        <div className={styles.panel}>
          <div className={styles.zoneList} role="listbox" aria-label="โซนบนผัง">
            {plan.zones.map((zone) => (
              <button key={zone.id} type="button" role="option" aria-selected={zone.id === selectedId}
                className={zone.id === selectedId ? styles.zoneSelected : ""} onClick={() => setSelectedId(zone.id)}>
                <span>{zone.label}</span><small>{zone.kind === "shelf" ? zone.shelfId : kindLabel[zone.kind]}</small>
              </button>
            ))}
          </div>

          {selected ? (
            <div className={styles.form}>
              <label className={styles.field}><span>ชื่อโซน</span>
                <input value={selected.label} maxLength={40} onChange={(event) => updateZone(selected.id, { label: event.target.value })} /></label>
              {selected.kind === "shelf" && <>
                <label className={styles.field}><span>Shelf ID (ตรงกับ ESP32)</span>
                  <input value={selected.shelfId ?? ""} list="known-shelves" maxLength={32}
                    onChange={(event) => updateZone(selected.id, { shelfId: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} /></label>
                <label className={styles.field}><span>รายละเอียด</span>
                  <input value={selected.detail ?? ""} maxLength={40} onChange={(event) => updateZone(selected.id, { detail: event.target.value })} /></label>
                <fieldset className={styles.anchorFields}>
                  <legend>ตำแหน่ง ESP32 (เมตร จากมุมซ้ายบน)</legend>
                  {(["x", "y"] as const).map((axis) => (
                    <label key={axis} className={styles.field}><span>{axis.toUpperCase()}</span>
                      <input type="number" inputMode="decimal" step={0.05} value={toM(anchorPoint(selected)[axis])}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value)) updateAnchor(selected.id, { ...anchorPoint(selected), [axis]: value / scale });
                        }} />
                    </label>
                  ))}
                  <button type="button" className={styles.linkButton} disabled={!selected.anchor} onClick={() => updateAnchor(selected.id, null)}>วางที่กึ่งกลางชั้น</button>
                </fieldset>
              </>}
              <div className={styles.grid4}>{numberField("x", "X")}{numberField("y", "Y")}{numberField("w", "กว้าง")}{numberField("h", "สูง")}</div>
              <button type="button" className={styles.deleteButton} disabled={saving || plan.zones.length <= 1} onClick={removeSelected}><Trash2 size={15} aria-hidden="true" /> ลบโซนนี้</button>
            </div>
          ) : <p className={admin.muted}>เลือกโซนบนผังหรือในรายการเพื่อแก้ไข</p>}
          <datalist id="known-shelves">{[...new Set([...reportedShelves, "SHELF-01", "SHELF-02", "SHELF-03"])].map((id) => <option key={id} value={id} />)}</datalist>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={admin.primaryButton} disabled={!dirty || saving} onClick={() => draft && void run(() => saveStoreLayout(plain(draft)), "บันทึกผังร้านแล้ว")}>
          {saving ? <LoaderCircle className={admin.spin} size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} บันทึกผังร้าน
        </button>
        <button type="button" className={admin.outlineButton} disabled={!dirty || saving} onClick={() => { setDraft(null); setError(""); setNotice(""); }}>
          <Undo2 size={16} aria-hidden="true" /> ยกเลิกการแก้ไข
        </button>
        <button type="button" className={admin.outlineButton} disabled={saving}
          onClick={() => { if (window.confirm("รีเซ็ตแผนผังร้านกลับเป็นค่าเริ่มต้น? ผังที่บันทึกไว้จะหายไป")) void run(resetStoreLayout, "รีเซ็ตผังร้านเป็นค่าเริ่มต้นแล้ว"); }}>
          <RotateCcw size={16} aria-hidden="true" /> รีเซ็ตเป็นค่าเริ่มต้น
        </button>
        <span className={styles.status}>{dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : server.updatedAt ? `บันทึกล่าสุด ${new Date(server.updatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}` : "ใช้ผังเริ่มต้น"}</span>
      </div>
    </section>
  );
}
