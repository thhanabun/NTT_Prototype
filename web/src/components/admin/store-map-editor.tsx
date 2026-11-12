"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { saveStoreMapLayout } from "@/lib/api/client";
import type { StoreMap, StoreShape } from "@/lib/api/types";
import { SHELF_OPTIONS } from "@/lib/shelves";
import { StoreMapView, metresPerUnit } from "./store-map-view";
import styles from "./customer-detection.module.css";

type Drag = { id: string; mode: "move" | "resize"; dx: number; dy: number };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;

/** Draw shelves and areas by dragging boxes. Measurements are optional: type one real length later. */
export function StoreMapEditor({ map, onSaved }: { map: StoreMap; onSaved: (map: StoreMap) => void }) {
  const [draft, setDraft] = useState(map);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [metres, setMetres] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = draft.shapes.find(shape => shape.id === selectedId) ?? null;
  const dirty = JSON.stringify({ ...draft, cameras: {} }) !== JSON.stringify({ ...map, cameras: {} });

  function update(id: string, change: Partial<StoreShape>) {
    setDraft(current => ({ ...current, shapes: current.shapes.map(shape => {
      if (shape.id !== id) return shape;
      const next = { ...shape, ...change };
      next.w = clamp(round(next.w), 1, current.width); next.h = clamp(round(next.h), 1, current.height);
      next.x = clamp(round(next.x), 0, current.width - next.w); next.y = clamp(round(next.y), 0, current.height - next.h);
      return next;
    }) }));
  }
  function add(kind: StoreShape["kind"]) {
    const shelf = SHELF_OPTIONS.find(option => !draft.shapes.some(shape => shape.shelfId === option.shelfId));
    if (kind === "shelf" && !shelf) { setStatus("วาง Shelf ครบทุกตัวแล้ว"); return; }
    const id = `${kind}-${Date.now().toString(36)}`;
    const shape: StoreShape = { id, kind, label: kind === "shelf" ? shelf!.label : `พื้นที่ ${draft.shapes.filter(s => s.kind === "area").length + 1}`,
      ...(kind === "shelf" ? { shelfId: shelf!.shelfId } : {}), x: draft.width / 2 - 10, y: draft.height / 2 - 5, w: 20, h: kind === "shelf" ? 8 : 10 };
    setDraft(current => ({ ...current, shapes: [...current.shapes, shape] }));
    setSelectedId(id); setStatus("");
  }
  function toMap(event: PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget, matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    const point = toMap(event);
    const target = (event.target as Element).closest("[data-shape],[data-handle]");
    if (!point || !target) { setSelectedId(null); return; }
    const id = target.getAttribute("data-shape") ?? target.getAttribute("data-handle")!;
    const shape = draft.shapes.find(item => item.id === id)!;
    const resize = target.hasAttribute("data-handle");
    setSelectedId(id);
    setDrag({ id, mode: resize ? "resize" : "move", dx: resize ? shape.x : point.x - shape.x, dy: resize ? shape.y : point.y - shape.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const point = drag && toMap(event);
    if (!drag || !point) return;
    if (drag.mode === "move") update(drag.id, { x: point.x - drag.dx, y: point.y - drag.dy });
    else update(drag.id, { w: point.x - drag.dx, h: point.y - drag.dy });
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (!selected || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0, dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    update(selected.id, event.shiftKey ? { w: selected.w + dx, h: selected.h + dy } : { x: selected.x + dx, y: selected.y + dy });
  }
  async function save() {
    setSaving(true); setStatus("");
    try {
      const saved = await saveStoreMapLayout({ version: 1, width: draft.width, height: draft.height, metresPerUnit: draft.metresPerUnit, shapes: draft.shapes });
      setDraft(saved); onSaved(saved); setStatus("บันทึกแผนที่แล้ว");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); }
    finally { setSaving(false); }
  }
  function applyScale() {
    const value = Number(metres);
    if (!selected || !Number.isFinite(value) || value <= 0 || value > 200) { setStatus("ใส่ความกว้างจริงเป็นเมตร เช่น 1.6"); return; }
    setDraft(current => ({ ...current, metresPerUnit: value / selected.w }));
    setStatus(`ตั้งสเกลจากความกว้าง ${selected.label} = ${value} ม. แล้ว กดบันทึกเพื่อใช้งาน`);
  }

  const handle = draft.width / 70;
  return <div className={styles.editor}>
    <div className={styles.cameraControls}>
      <button type="button" onClick={() => add("shelf")}>+ Shelf</button>
      <button type="button" onClick={() => add("area")}>+ พื้นที่</button>
      <label>กว้าง <input type="number" min={10} max={1000} value={draft.width} onChange={e => setDraft({ ...draft, width: clamp(Number(e.target.value) || 10, 10, 1000) })} /></label>
      <label>ลึก <input type="number" min={10} max={1000} value={draft.height} onChange={e => setDraft({ ...draft, height: clamp(Number(e.target.value) || 10, 10, 1000) })} /></label>
      <button type="button" className={styles.primary} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึกแผนที่"}</button>
      <button type="button" disabled={!dirty || saving} onClick={() => { setDraft(map); setStatus(""); }}>ยกเลิกการแก้ไข</button>
    </div>
    <p className={styles.calibration}>ลากกล่องเพื่อย้าย ลากมุมขวาล่างเพื่อปรับขนาด หรือเลือกกล่องแล้วใช้ลูกศร (Shift + ลูกศร = ปรับขนาด) · ไม่ต้องวัดขนาดจริงก่อน</p>
    <StoreMapView map={draft} selectedId={selectedId} className={styles.editorMap} tabIndex={0} label="ตัวแก้ไขแผนที่ร้าน ลากกล่อง Shelf และพื้นที่"
      onPointerDown={down} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
      {selected && <rect data-handle={selected.id} x={selected.x + selected.w - handle} y={selected.y + selected.h - handle} width={handle * 2} height={handle * 2}
        fill="var(--c-surface)" stroke="var(--c-hi)" strokeWidth={handle / 4} style={{ cursor: "nwse-resize" }} />}
    </StoreMapView>
    {selected && <div className={styles.cameraControls}>
      <label>ชื่อ <input value={selected.label} maxLength={40} onChange={e => update(selected.id, { label: e.target.value })} /></label>
      {selected.kind === "shelf" && <label>Shelf ID <select value={selected.shelfId} onChange={e => update(selected.id, { shelfId: e.target.value })}>
        {SHELF_OPTIONS.filter(o => o.shelfId === selected.shelfId || !draft.shapes.some(s => s.shelfId === o.shelfId)).map(o => <option key={o.shelfId} value={o.shelfId}>{o.shelfId}</option>)}
      </select></label>}
      <button type="button" onClick={() => { setDraft({ ...draft, shapes: draft.shapes.filter(s => s.id !== selected.id) }); setSelectedId(null); }}>ลบ</button>
      <label>ความกว้างจริงของกล่องนี้ (ม.) <input inputMode="decimal" value={metres} placeholder="เช่น 1.6" onChange={e => setMetres(e.target.value)} /></label>
      <button type="button" onClick={applyScale}>ตั้งสเกล</button>
      <span className={styles.muted}>ตอนนี้ ≈ {(selected.w * metresPerUnit(draft)).toFixed(2)} × {(selected.h * metresPerUnit(draft)).toFixed(2)} ม.</span>
    </div>}
    {draft.metresPerUnit !== null && <button type="button" className={styles.linkButton} onClick={() => setDraft({ ...draft, metresPerUnit: null })}>ล้างสเกลที่วัด (กลับไปใช้ค่าสมมติ)</button>}
    {status && <p role="status" className={styles.calibration}>{status}</p>}
  </div>;
}
