import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { variants } from "./_shared/variants";
import styles from "./gallery.module.css";

export const metadata = { title: "FAST | Design directions" };

export default function DesignGallery() {
  return (
    <section className={styles.gallery}>
      <p className={styles.eyebrow}>UX/UI EXPLORATION · SHOPPER SCREEN</p>
      <h1>5 แนวทางดีไซน์ใหม่<span>.</span></h1>
      <p className={styles.lead}>ทุกแบบใช้หน้าเดียวกัน คือหน้าตะกร้าของลูกค้า (เชื่อมตะกร้า → ดูรายการ → ยืนยันสินค้าที่ไม่แน่ชัด → ชำระเงิน) เพื่อเทียบกันได้ตรง ๆ เลือกแบบที่ชอบแล้วค่อยขยายไปหน้าอื่น</p>
      <div className={styles.grid}>
        {variants.map((v, i) => (
          <Link key={v.slug} href={`/design/${v.slug}`} className={styles.card} style={{ background: v.swatch[0], color: v.slug === "live" ? "#e8efe9" : "#1b1b1b" }}>
            <div className={styles.top}><b>0{i + 1}</b><ArrowUpRight size={20} aria-hidden="true" /></div>
            <div className={styles.dots}>{v.swatch.map((c) => <i key={c} style={{ background: c }} />)}</div>
            <h2>{v.name}</h2>
            <p className={styles.th}>{v.th}</p>
            <p>{v.note}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
