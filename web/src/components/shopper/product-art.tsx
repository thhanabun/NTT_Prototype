import type { Sku } from "@/lib/api/types";
import styles from "./shopper.module.css";

export function ProductArt({ sku, variant = sku === "SPRITE_PLUS_TEA" ? "sprite-tea" : undefined }: { sku: Sku; variant?: "cola" | "sprite-tea" | "blue-fanta" }) {
  if (variant === "sprite-tea" || variant === "blue-fanta") return (
    <div className={`${styles.productArt} ${variant === "sprite-tea" ? styles.spriteArt : styles.waterArt}`} aria-hidden="true">
      <div className={`${styles.bottle} ${variant === "sprite-tea" ? styles.spriteBottle : styles.fantaBottle}`}><i /><span>{variant === "sprite-tea" ? <>SPRITE<br />PLUS TEA</> : <>FANTA<br />FLORAL BLOOM</>}</span></div>
    </div>
  );
  return (
    <div className={`${styles.productArt} ${sku === "COKE" ? styles.cokeArt : styles.waterArt}`} aria-hidden="true">
      {sku === "COKE" ? <div className={styles.can}><span>Coca<br />Cola</span><i /></div>
        : <div className={styles.bottle}><i /><span>PURE<br />WATER</span></div>}
    </div>
  );
}
