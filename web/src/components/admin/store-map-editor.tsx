"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { StoreMap, StoreShape } from "@/lib/api/types";
import type { Point } from "@/lib/camera-calibration";
import { SHELF_OPTIONS } from "@/lib/shelves";
import { StoreMapView, corners, metresPerUnit } from "./store-map-view";
import styles from "./customer-detection.module.css";

type Drag = { id: string; mode: "move"; dx: number; dy: number } | { id: string; mode: "resize"; fixed: Point } | { id: string; mode: "rotate" };
const round = (v: number) => Math.round(v * 10) / 10;
const turn = (p: Point, degrees: number) => {
  const a = degrees * Math.PI / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};
const normalise = (degrees: number) => ((Math.round(degrees) + 540) % 360) - 180;

/** A new shelf (next free shelf ID) or area box placed in the middle of the map; null when every shelf is used. */
export function newShape(map: StoreMap, kind: StoreShape["kind"], box?: Pick<StoreShape, "x" | "y" | "w" | "h" | "angle">): StoreShape | null {
  const shelf = SHELF_OPTIONS.find(option => !map.shapes.some(shape => shape.shelfId === option.shelfId));
  if (kind === "shelf" && !shelf) return null;
  return { id: `${kind}-${Date.now().toString(36)}`, kind,
    label: kind === "shelf" ? shelf!.label : `พื้นที่ ${map.shapes.filter(s => s.kind === "area").length + 1}`,
    ...(kind === "shelf" ? { shelfId: shelf!.shelfId } : {}),
    ...(box ?? { x: map.width / 2 - 10, y: map.height / 2 - 5, w: 20, h: kind === "shelf" ? 8 : 10, angle: 0 }) };
}

export type MapEditing = {
  draft: StoreMap; set: (update: (map: StoreMap) => StoreMap) => void; remember: () => void; change: (update: (map: StoreMap) => StoreMap) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
};

/**
 * Draw shelves and areas: drag to move, drag a corner to resize, drag the round handle to turn.
 * The caller owns the draft and its undo history, so the camera setup can change the same map.
 */
export function StoreMapEditor({ editing, selectedId, onSelect, onSave, saveLabel = "บันทึกแผนที่", dirty, onRevert, onPoint, overlay, compact }: {
  editing: MapEditing; selectedId: string | null; onSelect: (id: string | null) => void;
  onSave?: () => void; saveLabel?: string; dirty?: boolean; onRevert?: () => void;
  /** When set, a click on the map reports the point instead of selecting (check tool). */
  onPoint?: (point: Point) => void; overlay?: ReactNode; compact?: boolean;
}) {
  const { draft, set, remember, change } = editing;
  const [drag, setDrag] = useState<Drag | null>(null);
  const moved = useRef(false); // A click that does not move anything adds no undo step.
  const [metres, setMetres] = useState("");
  const [status, setStatus] = useState("");
  const selected = draft.shapes.find(shape => shape.id === selectedId) ?? null;
  const outside = draft.shapes.filter(s => corners(s).some(p => p.x < 0 || p.y < 0 || p.x > draft.width || p.y > draft.height));

  const setShape = (id: string, update: (shape: StoreShape) => Partial<StoreShape>) =>
    set(current => ({ ...current, shapes: current.shapes.map(shape => shape.id === id ? { ...shape, ...update(shape) } : shape) }));
  function remove() {
    if (!selectedId) return;
    change(current => ({ ...current, shapes: current.shapes.filter(s => s.id !== selectedId) }));
    onSelect(null);
  }
  function add(kind: StoreShape["kind"]) {
    const shape = newShape(draft, kind);
    if (!shape) { setStatus("วาง Shelf ครบทุกตัวแล้ว"); return; }
    change(current => ({ ...current, shapes: [...current.shapes, shape] }));
    onSelect(shape.id); setStatus("");
  }
  function toMap(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    const point = toMap(event);
    if (point && onPoint) { onPoint(point); return; }
    const target = (event.target as Element).closest("[data-shape],[data-handle]");
    if (!point || !target) { onSelect(null); return; }
    const handle = target.getAttribute("data-handle");
    const id = handle ? selectedId! : target.getAttribute("data-shape")!;
    const shape = draft.shapes.find(item => item.id === id)!;
    moved.current = false;
    onSelect(id);
    if (handle === "rotate") setDrag({ id, mode: "rotate" });
    else if (handle) setDrag({ id, mode: "resize", fixed: corners(shape)[(Number(handle) + 2) % 4] });
    else setDrag({ id, mode: "move", dx: point.x - shape.x, dy: point.y - shape.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const point = drag && toMap(event);
    if (!drag || !point) return;
    if (!moved.current) { moved.current = true; remember(); } // One undo step per drag.
    if (drag.mode === "move") setShape(drag.id, () => ({ x: round(point.x - drag.dx), y: round(point.y - drag.dy) }));
    else if (drag.mode === "rotate") setShape(drag.id, s => {
      const degrees = Math.atan2(point.y - (s.y + s.h / 2), point.x - (s.x + s.w / 2)) * 180 / Math.PI + 90;
      return { angle: normalise(event.shiftKey ? degrees : Math.round(degrees / 5) * 5) }; // Snap to 5°; hold Shift for any angle.
    });
    else setShape(drag.id, s => {
      // Keep the opposite corner still and grow the box towards the pointer, in the shape's own turned frame.
      const local = turn({ x: point.x - drag.fixed.x, y: point.y - drag.fixed.y }, -(s.angle ?? 0));
      const w = Math.max(1, Math.abs(local.x)), h = Math.max(1, Math.abs(local.y));
      const offset = turn({ x: Math.sign(local.x || 1) * w / 2, y: Math.sign(local.y || 1) * h / 2 }, s.angle ?? 0);
      const cx = drag.fixed.x + offset.x, cy = drag.fixed.y + offset.y;
      return { w: round(w), h: round(h), x: round(cx - w / 2), y: round(cy - h / 2) };
    });
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (!selected) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); return; }
    if (event.key.toLowerCase() === "r") { event.preventDefault(); remember(); setShape(selected.id, s => ({ angle: normalise((s.angle ?? 0) + (event.shiftKey ? -15 : 15)) })); return; }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    remember();
    const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0, dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    setShape(selected.id, s => event.shiftKey ? { w: Math.max(1, s.w + dx), h: Math.max(1, s.h + dy) } : { x: s.x + dx, y: s.y + dy });
  }
  function applyScale() {
    const value = Number(metres);
    if (!selected || !Number.isFinite(value) || value <= 0 || value > 200) { setStatus("ใส่ความยาวจริงเป็นเมตร เช่น 1.6"); return; }
    change(current => ({ ...current, metresPerUnit: value / selected.w }));
    setStatus(`ตั้งสเกลจากความยาว ${selected.label} = ${value} ม. แล้ว กดบันทึกเพื่อใช้งาน`);
  }

  const handle = draft.width / 70;
  const sel = selected && corners(selected);
  const knob = selected && (() => {
    const top = turn({ x: 0, y: -selected.h / 2 - handle * 4 }, selected.angle ?? 0);
    return { x: selected.x + selected.w / 2 + top.x, y: selected.y + selected.h / 2 + top.y };
  })();
  const topMid = sel && { x: (sel[0].x + sel[1].x) / 2, y: (sel[0].y + sel[1].y) / 2 };
  return <div className={styles.editor}>
    <div className={styles.cameraControls}>
      <button type="button" onClick={() => add("shelf")}>+ Shelf</button>
      <button type="button" onClick={() => add("area")}>+ พื้นที่</button>
      <button type="button" disabled={!editing.canUndo} onClick={editing.undo} title="Ctrl+Z">↶ ย้อนกลับ</button>
      <button type="button" disabled={!editing.canRedo} onClick={editing.redo} title="Ctrl+Y หรือ Ctrl+Shift+Z">↷ ทำซ้ำ</button>
      {!compact && <>
        <label>กว้าง <input type="number" min={10} max={1000} value={draft.width} onFocus={remember} onChange={e => set(m => ({ ...m, width: Math.min(1000, Math.max(10, Number(e.target.value) || 10)) }))} /></label>
        <label>ลึก <input type="number" min={10} max={1000} value={draft.height} onFocus={remember} onChange={e => set(m => ({ ...m, height: Math.min(1000, Math.max(10, Number(e.target.value) || 10)) }))} /></label>
      </>}
      {onSave && <button type="button" className={styles.primary} disabled={!dirty || outside.length > 0} onClick={onSave}>{saveLabel}</button>}
      {onRevert && <button type="button" disabled={!dirty} onClick={onRevert}>ยกเลิกการแก้ไขทั้งหมด</button>}
    </div>
    {!compact && <p className={styles.calibration}>ลากกล่องเพื่อย้าย · ลากมุมสี่เหลี่ยมเพื่อปรับขนาด · ลากวงกลมด้านบนเพื่อหมุน (ทีละ 5°, กด Shift ค้างเพื่อหมุนอิสระ) · Ctrl+Z ย้อนกลับ, Ctrl+Y ทำซ้ำ · คีย์บอร์ด: ลูกศร = ย้าย, Shift+ลูกศร = ปรับขนาด, R = หมุน 15°, Delete = ลบ</p>}
    <StoreMapView map={draft} selectedId={selectedId} className={styles.editorMap} tabIndex={0} label="ตัวแก้ไขแผนที่ร้าน ลากกล่อง Shelf และพื้นที่"
      style={onPoint ? { cursor: "crosshair" } : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
      {!onPoint && selected && sel && knob && topMid && <g>
        <line x1={topMid.x} y1={topMid.y} x2={knob.x} y2={knob.y} stroke="var(--c-hi)" strokeWidth={handle / 4} />
        <circle data-handle="rotate" cx={knob.x} cy={knob.y} r={handle * 1.1} fill="var(--c-surface)" stroke="var(--c-hi)" strokeWidth={handle / 4} style={{ cursor: "grab" }} />
        {sel.map((p, i) => <rect key={i} data-handle={i} x={p.x - handle} y={p.y - handle} width={handle * 2} height={handle * 2}
          fill="var(--c-surface)" stroke="var(--c-hi)" strokeWidth={handle / 4} style={{ cursor: "nwse-resize" }} />)}
      </g>}
      {overlay}
    </StoreMapView>
    {outside.length > 0 && <p role="alert" className={styles.error}>{outside.map(s => s.label).join(", ")} อยู่นอกกรอบแผนที่ ย้ายเข้ามาก่อนบันทึก</p>}
    {selected && <div className={styles.cameraControls}>
      <label>ชื่อ <input value={selected.label} maxLength={40} onFocus={remember} onChange={e => setShape(selected.id, () => ({ label: e.target.value }))} /></label>
      {selected.kind === "shelf" && <label>Shelf ID <select value={selected.shelfId} onChange={e => change(m => ({ ...m, shapes: m.shapes.map(s => s.id === selected.id ? { ...s, shelfId: e.target.value } : s) }))}>
        {SHELF_OPTIONS.filter(o => o.shelfId === selected.shelfId || !draft.shapes.some(s => s.shelfId === o.shelfId)).map(o => <option key={o.shelfId} value={o.shelfId}>{o.shelfId}</option>)}
      </select></label>}
      <label>มุม (องศา) <input type="number" min={-180} max={180} value={selected.angle ?? 0} onFocus={remember} onChange={e => setShape(selected.id, () => ({ angle: normalise(Number(e.target.value) || 0) }))} /></label>
      <button type="button" onClick={() => { remember(); setShape(selected.id, s => ({ angle: normalise((s.angle ?? 0) - 15) })); }}>↺ 15°</button>
      <button type="button" onClick={() => { remember(); setShape(selected.id, s => ({ angle: normalise((s.angle ?? 0) + 15) })); }}>↻ 15°</button>
      <button type="button" onClick={remove}>ลบ</button>
    </div>}
    {selected && !compact && <div className={styles.cameraControls}>
      <label>ความยาวจริงของด้านยาว (ม.) <input inputMode="decimal" value={metres} placeholder="เช่น 1.6" onChange={e => setMetres(e.target.value)} /></label>
      <button type="button" onClick={applyScale}>ตั้งสเกล</button>
      <span className={styles.muted}>ตอนนี้ ≈ {(selected.w * metresPerUnit(draft)).toFixed(2)} × {(selected.h * metresPerUnit(draft)).toFixed(2)} ม.</span>
      {draft.metresPerUnit !== null && <button type="button" className={styles.linkButton} onClick={() => change(m => ({ ...m, metresPerUnit: null }))}>ล้างสเกลที่วัด</button>}
    </div>}
    {status && <p role="status" className={styles.calibration}>{status}</p>}
  </div>;
}
