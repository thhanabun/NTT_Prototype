import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { variants } from "./variants";
import styles from "./frame.module.css";

export function DesignFrame({ slug, children, stage, dark }: { slug: string; children: ReactNode; stage?: string; dark?: boolean }) {
  const index = variants.findIndex((v) => v.slug === slug);
  const v = variants[index];
  return (
    <div className={`${styles.wrap} ${dark ? styles.dark : ""}`} style={{ background: stage }}>
      <div className={styles.bar}>
        <Link href="/design" className={styles.back}><ArrowLeft size={15} aria-hidden="true" /> ทุกแบบ</Link>
        <nav className={styles.tabs} aria-label="Design variants">
          {variants.map((item, i) => (
            <Link key={item.slug} href={`/design/${item.slug}`} aria-current={item.slug === slug ? "page" : undefined}>
              <b>{i + 1}</b> {item.name}
            </Link>
          ))}
        </nav>
      </div>
      <div className={styles.stage}>
        <aside className={styles.caption}>
          <span>แบบที่ {index + 1} / {variants.length}</span>
          <h1>{v.name}</h1>
          <p className={styles.th}>{v.th}</p>
          <p>{v.note}</p>
          <div className={styles.swatches}>{v.swatch.map((c) => <i key={c} style={{ background: c }} title={c} />)}</div>
          <small>ข้อมูลตัวอย่าง · กดยืนยัน/ชำระเงินได้ ไม่เรียก API จริง</small>
        </aside>
        <div className={styles.phone}>{children}</div>
      </div>
    </div>
  );
}
