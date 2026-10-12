"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import type { Basket, BasketCase, BasketId } from "@/lib/api/types";
import styles from "./admin.module.css";

export function StaffActions({ item, baskets, disabled, pending, onDecide }: {
  item: BasketCase;
  baskets: Basket[];
  disabled: boolean;
  pending: boolean;
  onDecide: (decision: "APPROVE" | "REJECT", target?: BasketId) => void;
}) {
  const [choices, setChoices] = useState<Record<string, BasketId>>({});
  const target = choices[item.caseId] ?? item.candidate;
  if (item.status !== "OPEN_STAFF") return null;
  const basket = baskets.find((entry) => entry.basketId === target);
  const quantity = basket?.lines.find((line) => line.sku === item.sku)?.quantity ?? 0;
  const invalidReason = !target ? "เลือกตะกร้าที่ตรวจสอบแล้วก่อน Approve"
    : !basket?.session ? `Basket ${target} ยังไม่มี active session กรุณาเริ่มจาก Shopper`
      : item.eventType === "PUT_BACK" && !quantity ? `ไม่มี ${item.sku} ที่ยืนยันใน Basket ${target} จึงยัง Approve การคืนไม่ได้`
        : null;

  return (
    <div className={styles.staffActions} aria-label="Staff decision">
      <h3>ตัดสินหลังตรวจสอบหลักฐาน</h3>
      <fieldset disabled={disabled}><legend>เลือกตะกร้าที่ตรวจสอบแล้ว</legend><div className={styles.targetChoices}>{(["A", "B"] as const).map((id) => <label key={id} className={target === id ? styles.chosenTarget : ""}><input type="radio" name={`target-${item.caseId}`} checked={target === id} onChange={() => setChoices((previous) => ({...previous, [item.caseId]: id}))} /><span>Basket {id}</span><small>{baskets.find((entry) => entry.basketId === id)?.session ? "Active" : "No session"}</small></label>)}</div></fieldset>
      {invalidReason && <p className={styles.validation} id="decision-reason">{invalidReason}</p>}
      {!basket?.session && target && <Link className={styles.shopperLink} href={`/shopper?basket=${target}`} target="_blank" rel="noopener noreferrer">เปิด Shopper ของ Basket {target} →</Link>}
      <div className={styles.actionButtons}><button className={styles.primaryButton} disabled={disabled || Boolean(invalidReason)} aria-describedby={invalidReason ? "decision-reason" : undefined} onClick={() => onDecide("APPROVE", target ?? undefined)}>{pending ? <LoaderCircle className={styles.spin} size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />} Approve{target ? ` → ${target}` : ""}</button><button className={styles.rejectButton} disabled={disabled} onClick={() => onDecide("REJECT")}><X size={17} aria-hidden="true" /> Reject</button></div>
      <p className={styles.footnote}>Backend ตรวจสอบ cart อีกครั้งก่อนเปลี่ยนข้อมูล Reject จะปิดเคสโดยไม่เปลี่ยน cart</p>
    </div>
  );
}
