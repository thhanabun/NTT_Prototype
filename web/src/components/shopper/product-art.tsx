import type { Sku } from "@/lib/api/types";
import styles from "./shopper.module.css";

export function ProductArt({ sku }: { sku: Sku }) {
  return (
    <div className={`${styles.productArt} ${sku === "COKE" ? styles.cokeArt : styles.waterArt}`} aria-hidden="true">
      {sku === "COKE" ? <div className={styles.can}><span>Coca<br />Cola</span><i /></div>
        : <div className={styles.bottle}><i /><span>PURE<br />WATER</span></div>}
    </div>
  );
}
