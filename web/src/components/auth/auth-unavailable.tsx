import Link from "next/link";
import styles from "./auth.module.css";

export function AuthUnavailable() {
  return <section className={styles.unavailable}>
    <span className={styles.badge}>ADMIN ACCESS</span>
    <h1>Admin login ยังไม่เปิดใช้งาน</h1>
    <p className={styles.muted}>ระบบยืนยันตัวตนจริงกำลังรอเชื่อมกับ backend จึงยังเข้า Admin จากโหมดนี้ไม่ได้</p>
    {process.env.NODE_ENV === "development" && <p className={styles.muted}>สำหรับ local demo ให้รัน <code>npm run dev:mock</code> จากโฟลเดอร์ web</p>}
    <Link href="/shopper">ไป Shopper App →</Link>
  </section>;
}
