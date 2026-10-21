import type { Connection } from "@/lib/api/live-state";

export function ConnectionStatus({ connection, retryAttempt, stale }: { connection:Connection; retryAttempt:number; stale:boolean }) {
  const labels: Record<Connection,string> = {
    connecting:"กำลังเชื่อมต่อ realtime",
    live:"Realtime connected",
    reconnecting:`กำลังเชื่อมต่อใหม่ · ${retryAttempt}/5`,
    offline:"Realtime offline · กดอัปเดตเพื่อเชื่อมต่อใหม่",
    manual:"Browser ไม่มี SSE · ใช้ปุ่มอัปเดตข้อมูล",
  };
  return <span role="status">{labels[connection]}{stale && connection === "live" ? " · ยังยืนยันข้อมูลล่าสุดไม่ได้" : ""}</span>;
}
