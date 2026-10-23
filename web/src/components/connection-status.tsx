import type { Connection } from "@/lib/api/live-state";

export function ConnectionStatus({ connection, retryAttempt, stale }: { connection:Connection; retryAttempt:number; stale:boolean }) {
  const labels: Record<Connection,string> = {
    connecting:"กำลังเชื่อมต่อ",
    live:"เชื่อมต่อแล้ว",
    reconnecting:`กำลังเชื่อมต่อใหม่ · ${retryAttempt}/5`,
    offline:"ออฟไลน์ · กดอัปเดตเพื่อลองใหม่",
    manual:"กดอัปเดตเพื่อรับข้อมูลล่าสุด",
  };
  return <span role="status">{labels[connection]}{stale && connection === "live" ? " · รอข้อมูลล่าสุด" : ""}</span>;
}
