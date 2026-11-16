"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./admin-shell.module.css";

// One menu for the whole Admin side (design M1): overview, live store, ask Laya, and cameras with their three setup views.
const MENU = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/live", label: "ร้านสด" },
  { href: "/admin/laya", label: "ถาม Laya" },
  { href: "/admin/cameras/setup", label: "กล้อง", group: "/admin/cameras" },
  { href: "/admin/cameras/setup", label: "ตั้งค่ากล้อง", sub: true },
  { href: "/admin/cameras/sync", label: "ปรับจากคนเดิน", sub: true },
  { href: "/admin/cameras/map", label: "แก้แผนที่ร้าน", sub: true },
];

function Clock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour12: false }));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className={styles.live}><span aria-hidden="true" />LIVE{now && ` · ${now}`}</span>;
}

export function AdminShell({ identity, onSignOut, tools, children }: { identity: string; onSignOut: () => void; tools?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const inCameras = pathname.startsWith("/admin/cameras");
  return <div className={`admin-shell ${styles.shell}`}>
    <nav className={styles.nav} aria-label="เมนู Admin">
      <Link className={styles.brand} href="/admin" aria-label="FAST Admin หน้าภาพรวม"><span className={styles.logo}><Zap size={16} fill="currentColor" aria-hidden="true" /></span><b>FAST<i>.</i></b><small>Admin</small></Link>
      {MENU.filter(item => !item.sub || inCameras).map(item => {
        const current = item.sub ? pathname === item.href : item.group ? false : pathname === item.href;
        const open = item.group ? inCameras : current;
        return <Link key={item.label} href={item.href} className={`${styles.item} ${item.sub ? styles.sub : ""} ${open ? styles.on : ""}`} aria-current={current ? "page" : undefined}>{item.label}</Link>;
      })}
      <div className={styles.foot}>
        <Clock />
        <span className={styles.who}>{identity}</span>
        {tools}
        <div className={styles.footRow}><ThemeToggle /><button type="button" className={styles.signOut} onClick={onSignOut}><LogOut size={15} aria-hidden="true" /> ออกจากระบบ</button></div>
      </div>
    </nav>
    <div className={styles.content}>{children}</div>
  </div>;
}
