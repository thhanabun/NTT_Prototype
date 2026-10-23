"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { LayoutDashboard, LogOut, MessageCircle, Moon, Move, ShoppingBasket, Sun, X, Zap } from "lucide-react";
import { adminAuthEnabled } from "@/lib/auth/config";
import { signOutAdmin, useAdminSession } from "@/lib/auth/session";
import { toggleTheme } from "./theme-toggle";
import styles from "./floating-menu.module.css";

const POSITION_KEY = "fast-dock-position";
const SIZE = 62;
const MARGIN = 12;
export const OPEN_CHAT_EVENT = "fast:open-chat";

type Point = { x: number; y: number };
const clamp = (point: Point): Point => ({
  x: Math.min(Math.max(MARGIN, point.x), window.innerWidth - SIZE - MARGIN),
  y: Math.min(Math.max(MARGIN, point.y), window.innerHeight - SIZE - MARGIN),
});

// One floating button for the whole site: drag it anywhere, tap it for settings, theme, chat and sign-out.
export function FloatingMenu() {
  const pathname = usePathname();
  const auth = useAdminSession();
  const signedIn = adminAuthEnabled && auth.status === "signed-in";
  const chatAvailable = signedIn && pathname.startsWith("/admin") && !pathname.startsWith("/admin/login");
  const [position, setPosition] = useState<Point | null>(null);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ start: Point; origin: Point; moved: boolean } | null>(null);
  const moved = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read after mount so the server and first client render agree on the default corner.
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
        if (saved && typeof saved.x === "number" && typeof saved.y === "number") setPosition(clamp(saved));
      } catch { /* storage blocked: keep the default corner */ }
    });
    const keepInside = () => setPosition((current) => (current ? clamp(current) : current));
    window.addEventListener("resize", keepInside);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", keepInside); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const onDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    menu.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  function current(): Point {
    const box = button.current?.getBoundingClientRect();
    return box ? { x: box.left, y: box.top } : { x: MARGIN, y: MARGIN };
  }
  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    drag.current = { start: { x: event.clientX, y: event.clientY }, origin: current(), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.start.x, dy = event.clientY - state.start.y;
    if (!state.moved && Math.hypot(dx, dy) < 6) return;
    state.moved = true;
    setOpen(false);
    setPosition(clamp({ x: state.origin.x + dx, y: state.origin.y + dy }));
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    moved.current = Boolean(state?.moved);
    if (state?.moved) {
      const point = clamp({ x: state.origin.x + event.clientX - state.start.x, y: state.origin.y + event.clientY - state.start.y });
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(point)); } catch { /* position still applies for this visit */ }
    }
  }
  function onClick() {
    if (moved.current) { moved.current = false; return; }
    setOpen((value) => !value);
  }
  function resetPosition() {
    setPosition(null);
    try { localStorage.removeItem(POSITION_KEY); } catch { /* nothing saved */ }
  }

  const point = position;
  const lowerHalf = point ? point.y > (typeof window === "undefined" ? 0 : window.innerHeight / 2) : true;
  const rightHalf = point ? point.x > (typeof window === "undefined" ? 0 : window.innerWidth / 2) : false;
  const anchor = point ? { left: point.x, top: point.y } : undefined;

  return <>
    <button ref={button} type="button" className={`${styles.dock} ${point ? "" : styles.home}`} style={anchor}
      aria-label="เมนูลัด FAST (ลากเพื่อย้ายตำแหน่งได้)" aria-haspopup="true" aria-expanded={open} aria-controls="fast-quick-menu"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} onClick={onClick}>
      {open ? <X size={24} aria-hidden="true" /> : <Zap size={24} fill="currentColor" aria-hidden="true" />}
      {chatAvailable && <span className={styles.online} aria-hidden="true" />}
    </button>
    {open && <div ref={menu} id="fast-quick-menu" className={`${styles.menu} ${lowerHalf ? styles.above : styles.below} ${rightHalf ? styles.alignRight : ""}`}
      style={point ? { left: rightHalf ? undefined : point.x, right: rightHalf ? window.innerWidth - point.x - SIZE : undefined, top: lowerHalf ? undefined : point.y + SIZE + 10, bottom: lowerHalf ? window.innerHeight - point.y + 10 : undefined } : undefined}
      role="group" aria-label="เมนูลัดและการตั้งค่า">
      <p className={styles.title}>FAST · เมนูลัด</p>
      {chatAvailable && <button type="button" className={styles.primary} aria-label="เปิดแชทถามข้อมูลร้าน" onClick={() => { setOpen(false); window.dispatchEvent(new Event(OPEN_CHAT_EVENT)); }}>
        <span className={styles.icon}><MessageCircle size={18} aria-hidden="true" /></span><span><b>ถามข้อมูลร้าน</b><small>แชทกับ Laya · ผลเปิดเป็นแท็บใหม่</small></span>
      </button>}
      <button type="button" onClick={() => toggleTheme()}>
        <span className={styles.icon}><Moon className="icon-moon" size={18} aria-hidden="true" /><Sun className="icon-sun" size={18} aria-hidden="true" /></span>
        <span><b>สลับธีม</b><small>โหมดปกติ / Night mode</small></span>
      </button>
      <Link href="/shopper" onClick={() => setOpen(false)}><span className={styles.icon}><ShoppingBasket size={18} aria-hidden="true" /></span><span><b>หน้า Shopper</b><small>ฝั่งลูกค้า</small></span></Link>
      <Link href="/admin" onClick={() => setOpen(false)}><span className={styles.icon}><LayoutDashboard size={18} aria-hidden="true" /></span><span><b>หน้า Admin</b><small>{signedIn ? auth.session.email : "สำหรับพนักงาน"}</small></span></Link>
      {point && <button type="button" onClick={resetPosition}><span className={styles.icon}><Move size={18} aria-hidden="true" /></span><span><b>ย้ายปุ่มกลับมุมล่างซ้าย</b><small>ลากปุ่มไปวางที่ไหนก็ได้</small></span></button>}
      {signedIn && <button type="button" className={styles.danger} onClick={() => { setOpen(false); void signOutAdmin(); }}>
        <span className={styles.icon}><LogOut size={18} aria-hidden="true" /></span><span><b>ออกจากระบบ Admin</b><small>{auth.session.email}</small></span>
      </button>}
    </div>}
  </>;
}
