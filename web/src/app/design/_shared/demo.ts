"use client";

// Design exploration only: local sample data, no API calls.
import { useState } from "react";
import { Coffee, Cookie, CupSoda, GlassWater, Milk, Sandwich, type LucideIcon } from "lucide-react";

export type DemoProduct = {
  sku: string;
  name: string;
  detail: string;
  price: number;
  lane: string;
  tint: string;
  ink: string;
  icon: LucideIcon;
};

export const products: DemoProduct[] = [
  { sku: "COKE", name: "Coca-Cola", detail: "กระป๋อง 325 ml", price: 25, lane: "01", tint: "#ffe1dc", ink: "#d8322b", icon: CupSoda },
  { sku: "WATER", name: "น้ำดื่ม", detail: "ขวด 600 ml", price: 15, lane: "02", tint: "#dcefff", ink: "#1f78c1", icon: GlassWater },
  { sku: "MILK", name: "นมจืด", detail: "กล่อง 225 ml", price: 14, lane: "03", tint: "#eef1ff", ink: "#4a55c9", icon: Milk },
  { sku: "SNACK", name: "มันฝรั่งทอด", detail: "ซอง 48 g", price: 20, lane: "04", tint: "#fff1cc", ink: "#c98400", icon: Cookie },
  { sku: "SAND", name: "แซนด์วิชทูน่า", detail: "ชิ้น 120 g", price: 35, lane: "05", tint: "#e6f6dd", ink: "#3d8a28", icon: Sandwich },
  { sku: "TEA", name: "ชาเขียว", detail: "ขวด 420 ml", price: 20, lane: "06", tint: "#e3f5ec", ink: "#1b8a5a", icon: Coffee },
];

export const bySku = (sku: string) => products.find((p) => p.sku === sku)!;
export const money = (n: number) => `฿${n.toLocaleString("th-TH")}`;

export type Line = { sku: string; qty: number };
export type Pending = { sku: string; kind: "PICK" | "PUT_BACK" };

const initialLines: Line[] = [{ sku: "COKE", qty: 1 }, { sku: "WATER", qty: 2 }, { sku: "SNACK", qty: 1 }];
const nextPicks = ["TEA", "SAND", "MILK", "COKE"];

export function useDemoBasket() {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [pending, setPending] = useState<Pending | null>({ sku: "TEA", kind: "PICK" });
  const [staff, setStaff] = useState(0);
  const [pickIndex, setPickIndex] = useState(1);
  const [paid, setPaid] = useState(false);

  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + bySku(l.sku).price * l.qty, 0);
  const pendingValue = pending ? bySku(pending.sku).price : 0;
  const canPay = lines.length > 0 && !pending && staff === 0 && !paid;
  const blockReason = paid ? "" : pending ? "ยืนยันรายการที่รออยู่ก่อนชำระเงิน"
    : staff ? "พนักงานกำลังตรวจสอบ 1 รายการ" : !lines.length ? "ยังไม่มีสินค้าในตะกร้า" : "";

  function confirm(yes: boolean) {
    if (!pending) return;
    if (yes) {
      setLines((cur) => {
        const found = cur.find((l) => l.sku === pending.sku);
        return found ? cur.map((l) => (l.sku === pending.sku ? { ...l, qty: l.qty + 1 } : l)) : [...cur, { sku: pending.sku, qty: 1 }];
      });
    } else {
      setStaff((n) => n + 1);
      setTimeout(() => setStaff((n) => Math.max(0, n - 1)), 2600);
    }
    setPending(null);
  }

  function simulatePick() {
    setPaid(false);
    setPending({ sku: nextPicks[pickIndex % nextPicks.length], kind: "PICK" });
    setPickIndex((i) => i + 1);
  }

  function pay() { if (canPay) setPaid(true); }
  function reset() { setLines(initialLines); setPending({ sku: "TEA", kind: "PICK" }); setStaff(0); setPaid(false); }

  return { lines, pending, staff, count, total, pendingValue, canPay, blockReason, paid, confirm, simulatePick, pay, reset };
}

export type DemoBasket = ReturnType<typeof useDemoBasket>;
