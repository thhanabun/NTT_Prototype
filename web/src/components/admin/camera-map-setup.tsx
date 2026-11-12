"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { saveCameraMapping, saveStoreMapLayout } from "@/lib/api/client";
import type { CameraMapping, StoreMap, StoreShape } from "@/lib/api/types";
import { boxFromCorners, fitHomography, invert, project, sortCorners, type Point } from "@/lib/camera-calibration";
import { useHistory, useUndoKeys } from "@/lib/use-history";
import { StoreMapEditor, newShape, type MapEditing } from "./store-map-editor";
import { corners, metresPerUnit } from "./store-map-view";
import styles from "./customer-detection.module.css";

type Quads = Record<string, Point[]>;
type Tool = "edit" | "draw" | "check";
const CHECK_SIZE_M = 0.6; // The check box is a 60 cm square on the floor, about one person standing.
const GOOD_M = 0.15, FAIR_M = 0.4;
const layoutKey = (map: StoreMap) => JSON.stringify({ ...map, cameras: {} });
const inside = (p: Point, poly: Point[]) => poly.reduce((hit, a, i) => {
  const b = poly[(i + poly.length - 1) % poly.length];
  return (a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x ? !hit : hit;
}, false);
const rotate = (quad: Point[], by: number) => quad.map((_, i) => quad[(i + by) % 4]);
const shelfColour = (shape: StoreShape) => shape.kind === "shelf" ? "#f47b3c" : "#6f9fe8";

/** Mapping image → map fitted over every shape that has both a camera outline and a map box (least squares). */
function fitFrom(map: StoreMap, quads: Quads, skip?: string) {
  const pairs = map.shapes.filter(s => quads[s.id] && s.id !== skip);
  if (!pairs.length) return null;
  try { return fitHomography(pairs.flatMap(s => quads[s.id]), pairs.flatMap(s => corners(s))); } catch { return null; }
}
/** Average distance in metres between a shape's map corners and where its camera outline lands on the map. */
function mismatch(map: StoreMap, h: number[], shape: StoreShape, quad: Point[]) {
  const target = corners(shape);
  const total = quad.reduce((sum, p, i) => { const q = project(h, p); return sum + (q ? Math.hypot(q.x - target[i].x, q.y - target[i].y) : Infinity); }, 0);
  return total / 4 * metresPerUnit(map);
}

/**
 * Camera picture and store map side by side. Draw a shelf on either side first; Sync makes the two agree;
 * the check tool shows where a map spot falls on the camera (and back).
 */
export function CameraMapSetup({ cameraId, map, saved, snapshot, onRefresh, onClose }: {
  cameraId: string; map: StoreMap; saved: CameraMapping | null; snapshot: HTMLCanvasElement;
  onRefresh: () => HTMLCanvasElement | null; onClose: () => void;
}) {
  const initialQuads = useMemo(() => Object.fromEntries(Object.entries(saved?.quads ?? {}).filter(([id]) => map.shapes.some(s => s.id === id))), [saved, map]);
  const history = useHistory({ map, quads: initialQuads as Quads });
  const { map: draft, quads: allQuads } = history.value;
  const quads = useMemo(() => Object.fromEntries(Object.entries(allQuads).filter(([id]) => draft.shapes.some(s => s.id === id))), [allQuads, draft]);
  useUndoKeys(history.undo, history.redo);
  const [frame, setFrame] = useState(snapshot);
  const [tool, setTool] = useState<Tool>("edit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clicks, setClicks] = useState<Point[]>([]);
  const [target, setTarget] = useState("");
  const [check, setCheck] = useState<Point | null>(null);
  const [focusCorner, setFocusCorner] = useState<{ id: string; i: number } | null>(null);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ id: string; i: number; moved: boolean } | null>(null);

  // Live fit for display; Sync is what makes both sides agree. Older mappings without outlines still show.
  const h = useMemo(() => fitFrom(draft, quads) ?? (Object.keys(quads).length ? null : saved?.h ?? null), [draft, quads, saved]);
  const back = useMemo(() => { try { return h && invert(h); } catch { return null; } }, [h]);
  const errors = useMemo(() => h ? draft.shapes.filter(s => quads[s.id]).map(s => ({ shape: s, metres: mismatch(draft, h, s, quads[s.id]) })) : [], [h, draft, quads]);
  const projected = useMemo(() => back ? Object.fromEntries(draft.shapes.filter(s => !quads[s.id]).map(s => [s.id, corners(s).map(p => project(back, p))]).filter(([, pts]) => (pts as (Point | null)[]).every(Boolean))) as Quads : {}, [back, draft, quads]);
  const checkQuad = useMemo(() => {
    if (!check || !back) return null;
    const half = CHECK_SIZE_M / 2 / metresPerUnit(draft);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => project(back, { x: check.x + sx * half, y: check.y + sy * half }));
    return pts.every(Boolean) ? pts as Point[] : null;
  }, [check, back, draft]);
  const nearest = useMemo(() => {
    if (!check) return null;
    const scale = metresPerUnit(draft);
    return draft.shapes.map(s => {
      const c = corners(s), cx = c.reduce((a, p) => a + p.x, 0) / 4, cy = c.reduce((a, p) => a + p.y, 0) / 4;
      return { label: s.label, metres: Math.hypot(check.x - cx, check.y - cy) * scale };
    }).sort((a, b) => a.metres - b.metres)[0] ?? null;
  }, [check, draft]);
  const dirty = layoutKey(draft) !== layoutKey(map) || JSON.stringify(quads) !== JSON.stringify(initialQuads);
  const worst = errors.reduce((m, e) => Math.max(m, e.metres), 0);

  // Camera side: picture, outlines drawn on the camera (solid), map shapes not yet drawn there (dashed), the check box.
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const { width, height } = frame;
    const px = (p: Point) => [p.x * width, p.y * height] as const;
    context.drawImage(frame, 0, 0);
    const outline = (pts: Point[], colour: string, dashed: boolean, thick: boolean) => {
      context.strokeStyle = colour; context.lineWidth = thick ? 3.5 : 2; context.setLineDash(dashed ? [7, 5] : []);
      context.beginPath(); pts.forEach((p, i) => i ? context.lineTo(...px(p)) : context.moveTo(...px(p))); context.closePath(); context.stroke(); context.setLineDash([]);
    };
    for (const shape of draft.shapes) {
      const pts = quads[shape.id] ?? projected[shape.id];
      if (!pts) continue;
      const colour = shelfColour(shape), drawn = Boolean(quads[shape.id]);
      outline(pts, colour, !drawn, shape.id === selectedId);
      const [cx, cy] = px({ x: pts.reduce((a, p) => a + p.x, 0) / 4, y: pts.reduce((a, p) => a + p.y, 0) / 4 });
      context.font = "bold 13px sans-serif"; context.textAlign = "center"; context.fillStyle = colour;
      context.fillText(shape.label + (drawn ? "" : " (จากแผนที่)"), cx, cy); context.textAlign = "start";
      if (drawn) pts.forEach((p, i) => {
        const [x, y] = px(p);
        context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fillStyle = "#ffffff"; context.fill();
        context.lineWidth = focusCorner?.id === shape.id && focusCorner.i === i ? 3 : 1.5; context.strokeStyle = "#15251f"; context.stroke();
        context.font = "10px sans-serif"; context.fillStyle = "#15251f"; context.fillText(String(i + 1), x - 3, y + 3.5);
      });
    }
    clicks.forEach((p, i) => {
      const [x, y] = px(p);
      context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fillStyle = "#c9f56b"; context.fill();
      context.font = "bold 12px sans-serif"; context.fillStyle = "#c9f56b"; context.fillText(String(i + 1), x + 9, y - 6);
    });
    if (checkQuad) { outline(checkQuad, "#ff4fd8", false, true); const [x, y] = px(checkQuad[0]); context.fillStyle = "#ff4fd8"; context.font = "bold 12px sans-serif"; context.fillText("จุดที่เลือก", x, y - 6); }
  }, [frame, draft, quads, projected, selectedId, clicks, checkQuad, focusCorner]);

  const toImage = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { point: { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, rect };
  };
  function down(event: PointerEvent<HTMLCanvasElement>) {
    const { point, rect } = toImage(event);
    if (tool === "check") { if (h) setCheck(project(h, point)); else setStatus("ยังคำนวณไม่ได้ ต้องมีอย่างน้อย 1 รูปทรงที่วาดทั้งในกล้องและบนแผนที่"); return; }
    if (tool === "draw") { setClicks(current => current.length < 4 ? [...current, point] : current); return; }
    // Edit: grab the nearest outline corner; a dashed (map-only) outline becomes a camera outline when grabbed.
    let best: { id: string; i: number; d: number } | null = null;
    for (const [id, pts] of Object.entries({ ...projected, ...quads })) pts.forEach((p, i) => {
      const d = Math.hypot((p.x - point.x) * rect.width, (p.y - point.y) * rect.height);
      if (d <= 20 && (!best || d < best.d)) best = { id, i, d };
    });
    const grabbed = best as { id: string; i: number } | null;
    if (grabbed) {
      if (!quads[grabbed.id]) history.change(s => ({ ...s, quads: { ...s.quads, [grabbed.id]: projected[grabbed.id] } }));
      dragging.current = { ...grabbed, moved: false };
      setSelectedId(grabbed.id); setFocusCorner(grabbed);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const hit = draft.shapes.find(s => { const pts = quads[s.id] ?? projected[s.id]; return pts && inside(point, pts); });
    setSelectedId(hit?.id ?? null);
  }
  function moveCorner(id: string, i: number, point: Point) {
    const p = { x: Math.min(1.2, Math.max(-0.2, point.x)), y: Math.min(1.2, Math.max(-0.2, point.y)) };
    history.set(s => ({ ...s, quads: { ...s.quads, [id]: s.quads[id].map((q, k) => k === i ? p : q) } }));
  }
  function drag(event: PointerEvent<HTMLCanvasElement>) {
    const grab = dragging.current;
    if (!grab) return;
    if (!grab.moved) { grab.moved = true; history.remember(); }
    moveCorner(grab.id, grab.i, toImage(event).point);
  }
  function keys(event: KeyboardEvent<HTMLCanvasElement>) {
    // Keyboard: N picks the next outline corner, arrows move it (Shift = bigger steps).
    const order = draft.shapes.filter(s => quads[s.id]).flatMap(s => [0, 1, 2, 3].map(i => ({ id: s.id, i })));
    if (event.key.toLowerCase() === "n" && order.length) {
      event.preventDefault();
      const at = focusCorner ? order.findIndex(c => c.id === focusCorner.id && c.i === focusCorner.i) : -1;
      const next = order[(at + 1) % order.length];
      setFocusCorner(next); setSelectedId(next.id); return;
    }
    if (!focusCorner || !quads[focusCorner.id] || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const step = event.shiftKey ? .02 : .004, p = quads[focusCorner.id][focusCorner.i];
    history.remember();
    moveCorner(focusCorner.id, focusCorner.i, { x: p.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: p.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
  }

  /** Give the 4 drawn corners to a map shape (existing, or a new one placed where the current mapping says). */
  function assign() {
    if (clicks.length !== 4) return;
    let quad = sortCorners(clicks);
    if (target === "new-shelf" || target === "new-area") {
      const known = h && quad.map(p => project(h, p));
      const shape = newShape(draft, target === "new-shelf" ? "shelf" : "area", known && known.every(Boolean) ? boxFromCorners(known as Point[]) : undefined);
      if (!shape) { setStatus("วาง Shelf ครบทุกตัวแล้ว เลือกพื้นที่ใหม่หรือรูปทรงที่มีอยู่"); return; }
      history.change(s => ({ map: { ...s.map, shapes: [...s.map.shapes, shape] }, quads: { ...s.quads, [shape.id]: quad } }));
      setSelectedId(shape.id);
      setStatus(known ? `เพิ่ม ${shape.label} บนแผนที่ตามตำแหน่งที่คำนวณได้แล้ว` : `เพิ่ม ${shape.label} แล้ว ลากกล่องบนแผนที่ไปวางตำแหน่งจริง แล้วกดซิงก์`);
    } else {
      const shape = draft.shapes.find(s => s.id === target);
      if (!shape) { setStatus("เลือกว่ากรอบนี้คือรูปทรงไหน"); return; }
      // Pick which clicked corner is the shape's first corner: the turn that best agrees with the other shapes.
      const others = fitFrom(draft, quads, shape.id);
      if (others) quad = [0, 1, 2, 3].map(r => rotate(quad, r)).sort((a, b) => mismatch(draft, others, shape, a) - mismatch(draft, others, shape, b))[0];
      history.change(s => ({ ...s, quads: { ...s.quads, [shape.id]: quad } }));
      setSelectedId(shape.id);
      setStatus(others ? `จับคู่กรอบกับ ${shape.label} แล้ว` : `จับคู่กรอบกับ ${shape.label} แล้ว ถ้ามุมไม่ตรง ใช้ปุ่ม ↻ หมุนมุม`);
    }
    setClicks([]); setTarget(""); setTool("edit");
  }
  function syncMapFromCamera() {
    if (!h || !back) return;
    // Each map box becomes the nearest real rectangle to its camera outline; the outline is then squared to that box,
    // so both sides agree exactly afterwards.
    history.change(s => {
      const shapes = s.map.shapes.map(shape => {
        const pts = quads[shape.id]?.map(p => project(h, p));
        return pts && pts.every(Boolean) ? { ...shape, ...boxFromCorners(pts as Point[]) } : shape;
      });
      const squared = Object.fromEntries(shapes.filter(shape => quads[shape.id]).map(shape => [shape.id, corners(shape).map(p => project(back, p) ?? p)]));
      return { map: { ...s.map, shapes }, quads: { ...s.quads, ...squared } };
    });
    setStatus("ซิงก์แล้ว: ใช้กรอบในกล้องปรับกล่องบนแผนที่ (และจัดกรอบให้เป็นสี่เหลี่ยมจริง)");
  }
  function syncCameraFromMap() {
    if (!back) return;
    history.change(s => ({ ...s, quads: Object.fromEntries(s.map.shapes.map(shape => [shape.id, corners(shape).map(p => project(back, p))]).filter(([, pts]) => (pts as (Point | null)[]).every(Boolean))) as Quads }));
    setStatus("ซิงก์แล้ว: ปรับกรอบในกล้องตามแผนที่");
  }
  async function save() {
    if (!h) { setStatus("ยังบันทึกไม่ได้ ต้องมีอย่างน้อย 1 รูปทรงที่วาดทั้งในกล้องและบนแผนที่"); return; }
    setSaving(true); setStatus("");
    try {
      if (layoutKey(draft) !== layoutKey(map)) {
        const { version, width, height, metresPerUnit: scale, shapes } = draft;
        await saveStoreMapLayout({ version, width, height, metresPerUnit: scale, shapes });
      }
      await saveCameraMapping(cameraId, { width: saved?.width ?? frameSource.width, height: saved?.height ?? frameSource.height, h, quads });
      onClose();
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); }
    finally { setSaving(false); }
  }
  const frameSource = { width: Number(frame.dataset.sourceWidth) || frame.width, height: Number(frame.dataset.sourceHeight) || frame.height };
  const editing: MapEditing = {
    draft, remember: history.remember, undo: history.undo, redo: history.redo, canUndo: history.canUndo, canRedo: history.canRedo,
    set: update => history.set(s => ({ ...s, map: update(s.map) })), change: update => history.change(s => ({ ...s, map: update(s.map) })),
  };
  const selected = draft.shapes.find(s => s.id === selectedId);
  const unit = draft.width / 100;

  // A portal so no parent card's layout can clip or offset the full-screen window.
  return createPortal(<div className={styles.setupOverlay} role="dialog" aria-modal="true" aria-labelledby="setup-title"
    onKeyDown={event => { if (event.key === "Escape" && (!dirty || window.confirm("ปิดโดยไม่บันทึก?"))) onClose(); }}>
    <div className={styles.setupHeader}>
      <h2 id="setup-title">ตั้งค่า {cameraId} กับแผนที่ร้าน</h2>
      <div className={styles.cameraControls}>
        <button type="button" className={styles.primary} disabled={saving || !h} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}</button>
        <button type="button" onClick={() => { if (!dirty || window.confirm("ปิดโดยไม่บันทึก?")) onClose(); }}>ปิด</button>
      </div>
    </div>
    <div className={styles.cameraControls} role="group" aria-label="เครื่องมือ">
      <button type="button" aria-pressed={tool === "edit"} onClick={() => { setTool("edit"); setClicks([]); }}>✋ แก้ไข/ลาก</button>
      <button type="button" aria-pressed={tool === "draw"} onClick={() => { setTool("draw"); setClicks([]); setCheck(null); }}>✏️ วาดในกล้อง</button>
      <button type="button" aria-pressed={tool === "check"} onClick={() => { setTool("check"); setClicks([]); }}>🎯 ตรวจตำแหน่ง</button>
      <span className={styles.toolSep} />
      <button type="button" disabled={!h || !errors.length} onClick={syncMapFromCamera} title="ปรับกล่องบนแผนที่ให้ตรงกับกรอบที่วาดในกล้อง">⟵ ซิงก์: ใช้กล้องปรับแผนที่</button>
      <button type="button" disabled={!back} onClick={syncCameraFromMap} title="ปรับกรอบในกล้องให้ตรงกับกล่องบนแผนที่">ซิงก์: ใช้แผนที่ปรับกล้อง ⟶</button>
      <button type="button" disabled={!history.canUndo} onClick={history.undo} title="Ctrl+Z">↶</button>
      <button type="button" disabled={!history.canRedo} onClick={history.redo} title="Ctrl+Y">↷</button>
      <button type="button" onClick={() => { const next = onRefresh(); if (next) setFrame(next); }}>📷 ถ่ายภาพใหม่</button>
    </div>
    <p className={styles.calibration}>
      {tool === "draw" ? "คลิก 4 มุมบนพื้นของ Shelf/พื้นที่ในภาพกล้อง (ลำดับไหนก็ได้) แล้วเลือกว่าเป็นรูปทรงไหน"
        : tool === "check" ? "คลิกบนแผนที่หรือในภาพกล้อง: จะเห็นกรอบสีชมพูขนาด 60 ซม. ที่ตำแหน่งเดียวกันอีกฝั่ง ใช้ดูว่าตำแหน่งตรงจริงไหม"
        : "ลากมุมกรอบในกล้อง หรือลากกล่องบนแผนที่ · เส้นประ = รูปทรงที่มีแค่บนแผนที่ (ลากมุมเพื่อวางในกล้อง) · กดซิงก์เพื่อให้สองฝั่งตรงกัน · Ctrl+Z ย้อนกลับ"}
    </p>
    <div className={styles.setupGrid}>
      <section aria-label="ภาพกล้อง">
        <h3 className={styles.setupPaneTitle}>ภาพกล้อง</h3>
        <canvas ref={canvas} width={frame.width} height={frame.height} className={styles.setupCanvas} tabIndex={0}
          style={{ cursor: tool === "edit" ? "grab" : "crosshair" }} aria-label={`ภาพจาก ${cameraId} สำหรับวาดและตรวจตำแหน่ง`}
          onPointerDown={down} onPointerMove={drag} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }} onKeyDown={keys} />
        {tool === "draw" && <div className={styles.calibrationPrompt}>
          <span>{clicks.length < 4 ? `มุมที่ ${clicks.length + 1}/4` : "ครบ 4 มุมแล้ว"}</span>
          {clicks.length === 4 && <label>กรอบนี้คือ <select value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">— เลือก —</option>
            {draft.shapes.map(s => <option key={s.id} value={s.id}>{s.label}{quads[s.id] ? " (แทนกรอบเดิม)" : ""}</option>)}
            <option value="new-shelf">+ Shelf ใหม่</option><option value="new-area">+ พื้นที่ใหม่</option>
          </select></label>}
          <button type="button" className={styles.primary} disabled={clicks.length < 4 || !target} onClick={assign}>ตกลง</button>
          <button type="button" disabled={!clicks.length} onClick={() => setClicks([])}>เริ่มใหม่</button>
        </div>}
        {selected && quads[selected.id] && tool === "edit" && <div className={styles.cameraControls}>
          <span>{selected.label}</span>
          <button type="button" onClick={() => history.change(s => ({ ...s, quads: { ...s.quads, [selected.id]: rotate(s.quads[selected.id], 1) } }))}>↻ หมุนมุม</button>
          <button type="button" onClick={() => history.change(s => { const next = { ...s.quads }; delete next[selected.id]; return { ...s, quads: next }; })}>ลบกรอบในกล้อง</button>
        </div>}
      </section>
      <section aria-label="แผนที่ร้าน">
        <h3 className={styles.setupPaneTitle}>แผนที่ร้าน</h3>
        <StoreMapEditor editing={editing} selectedId={selectedId} onSelect={setSelectedId} compact
          onPoint={tool === "check" ? point => setCheck(point) : undefined}
          overlay={<>
            {h && draft.shapes.filter(s => quads[s.id]).map(s => {
              const pts = quads[s.id].map(p => project(h, p));
              return pts.every(Boolean) ? <polygon key={s.id} points={(pts as Point[]).map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#2c9a5b" strokeWidth={unit * .35} strokeDasharray={`${unit} ${unit * .6}`} style={{ pointerEvents: "none" }} /> : null;
            })}
            {check && <g style={{ pointerEvents: "none" }}>
              <rect x={check.x - CHECK_SIZE_M / 2 / metresPerUnit(draft)} y={check.y - CHECK_SIZE_M / 2 / metresPerUnit(draft)} width={CHECK_SIZE_M / metresPerUnit(draft)} height={CHECK_SIZE_M / metresPerUnit(draft)} fill="#ff4fd8" fillOpacity={.25} stroke="#ff4fd8" strokeWidth={unit * .4} />
              <circle cx={check.x} cy={check.y} r={unit * .6} fill="#ff4fd8" />
            </g>}
          </>} />
        <p className={styles.muted}>เส้นประสีเขียว = ตำแหน่งที่กรอบในกล้องบอก ถ้าทับกล่องพอดีแปลว่าสองฝั่งตรงกัน</p>
      </section>
    </div>
    <div className={styles.setupStatus} role="status">
      {!h ? <p>ยังคำนวณไม่ได้: วาดอย่างน้อย 1 รูปทรงให้มีทั้งในกล้องและบนแผนที่</p> : <>
        <p><b>{worst <= GOOD_M ? "✅ ตรงกันดี" : worst <= FAIR_M ? "⚠️ ใกล้เคียง กดซิงก์หรือปรับมุมเพิ่ม" : "❌ ยังไม่ตรง ตรวจมุมที่วาดหรือกด ↻ หมุนมุม"}</b>
          {errors.length === 1 && " · มีรูปทรงเดียว ผลตรงเสมอ วาดรูปทรงที่สองเพื่อตรวจความแม่นยำ"}</p>
        <ul className={styles.errorList}>{errors.map(e => <li key={e.shape.id} style={{ color: e.metres <= GOOD_M ? "var(--c-ok)" : e.metres <= FAIR_M ? "#b7791f" : "var(--c-danger)" }}>
          {e.shape.label}: คลาดเคลื่อน {e.metres.toFixed(2)} ม.</li>)}</ul>
      </>}
      {check && <p>จุดที่เลือก: ({(check.x * metresPerUnit(draft)).toFixed(2)}, {(check.y * metresPerUnit(draft)).toFixed(2)}) ม.{nearest ? ` · ใกล้ ${nearest.label} ${nearest.metres.toFixed(2)} ม.` : ""}{!checkQuad ? " · อยู่นอกมุมมองกล้อง" : ""}</p>}
      {status && <p>{status}</p>}
    </div>
  </div>, document.body);
}
