import styles from "./arc-gauge.module.css";

const SEGMENTS = 13;

// Decorative arc: filled segments are the confirmed share, hatched ones are pending. Numbers are shown as text by the caller.
export function ArcGauge({ confirmed, pending }: { confirmed: number; pending: number }) {
  const sum = confirmed + pending;
  const filled = sum ? Math.round((confirmed / sum) * SEGMENTS) : 0;
  return (
    <svg viewBox="0 0 300 190" className={styles.arc} aria-hidden="true" focusable="false">
      {Array.from({ length: SEGMENTS }, (_, index) => {
        const angle = -100 + (200 / (SEGMENTS - 1)) * index;
        const state = sum && index < filled ? styles.on : sum && pending ? styles.pending : styles.off;
        const opacity = sum && index < filled ? 0.55 + (index / SEGMENTS) * 0.45 : 1;
        return <rect key={index} className={state} x={138} y={14} width={24} height={44} rx={10} opacity={opacity} transform={`rotate(${angle} 150 160)`} />;
      })}
    </svg>
  );
}
