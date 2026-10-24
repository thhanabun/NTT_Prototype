export type MapView = "points" | "heatmap";
export type AdminCommand =
  | { kind: "theme"; value: "day" | "night" | "toggle" }
  | { kind: "map"; value: MapView | "toggle" }
  | { kind: "cases"; caseId?: string }
  | { kind: "help" };

// Explicit screen commands stay local; sales queries continue to use Laya.
export function parseAdminCommand(message: string): AdminCommand | null {
  const text = message.trim().normalize("NFC").toLowerCase();
  const theme = /theme|ธีม|โหมดมืด|โหมดสว่าง|dark mode|light mode|night mode/.test(text);
  const cases = /approve|reject|อนุมัติ|ปฏิเสธ|เคส|\bcase\b|case-\d/.test(text);
  const map = /heat\s*map|ฮีทแม[ปพ]|แผนที่|(?:แสดง|สลับ|เปลี่ยน|ดู).*จุด|(?:show|switch|change|display).*(?:points?|map)|^(จุด|points?|map)$/.test(text);
  if (!(theme || cases || map)) return null;
  if (/อย่า|ไม่ต้อง|do not|don't/.test(text) || [theme, cases, map].filter(Boolean).length > 1) return { kind: "help" };
  if (theme) return { kind: "theme", value: /night|dark|มืด|กลางคืน/.test(text) ? "night" : /day|light|สว่าง|ปกติ|กลางวัน/.test(text) ? "day" : "toggle" };
  if (cases) {
    const id = text.match(/case[-\s]?(\d+)/i)?.[1];
    return { kind: "cases", caseId: id ? `CASE-${id.padStart(3, "0")}` : undefined };
  }
  return { kind: "map", value: /จุด|\bpoints?\b/.test(text) && !/heat\s*map/.test(text) ? "points" : /heat\s*map|ฮีทแม[ปพ]/.test(text) && !/จุด/.test(text) ? "heatmap" : "toggle" };
}
