"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./admin-shell.module.css";

// The multi-camera store map (prototypes/shelf-calibration, served by its server.py) shown inside Admin.
// embed=1 hides its own menu; the hash picks the view. Set NEXT_PUBLIC_STORE_MAP_URL when it runs elsewhere.
const STORE_MAP_URL = process.env.NEXT_PUBLIC_STORE_MAP_URL ?? "http://127.0.0.1:8090";
export type StoreMapView = "live" | "setup" | "sync" | "map";
const TITLES: Record<StoreMapView, string> = { live: "ร้านสด", setup: "ตั้งค่ากล้อง", sync: "ปรับจากคนเดิน", map: "แก้แผนที่ร้าน" };

export function StoreMapFrame() {
  const path = usePathname();
  const view: StoreMapView = path.startsWith("/admin/cameras/") ? (path.split("/")[3] as StoreMapView) : "live";
  /* Load the map page once; later view changes go by message so it never reloads (a reload restarts its video and tracking). */
  const [src] = useState(() => `${STORE_MAP_URL}/?embed=1#${view}`);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ fastView: view }, STORE_MAP_URL); }, [view]);
  if (!TITLES[view]) return null;
  return <>
    <h1 className={styles.title}>{TITLES[view]}</h1>
    <iframe ref={frame} className={styles.frame} title={`แผนที่ร้านและกล้อง: ${TITLES[view]}`} src={src} allow="camera; fullscreen" />
    <p className={styles.hint}>ไม่เห็นแผนที่? เปิดเซิร์ฟเวอร์แผนที่ร้านก่อน: <code>prototypes/shelf-calibration/server.py</code> ({STORE_MAP_URL})</p>
  </>;
}
