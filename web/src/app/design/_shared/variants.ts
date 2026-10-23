// Design directions shown in the /design gallery.
export const variants = [
  { slug: "warm", name: "Warm Scan", th: "อบอุ่น · AI สแกน", note: "โทนครีม-ส้มจาก ref Dribbble เกจวงโค้งแสดงยอด และภาพชั้นวางพร้อมป้าย AI ชี้สินค้า", swatch: ["#efe8df", "#f47b3c", "#2b2420"] },
  { slug: "convenience", name: "Quick Mart", th: "ร้านสะดวกซื้อ", note: "แนวแอปสั่งของร้านสะดวกซื้อ: แบนเนอร์ หมวดหมู่ กริดสินค้า แถบตะกร้าลอยด้านล่าง", swatch: ["#ffffff", "#0b9b55", "#ff7a1a"] },
  { slug: "live", name: "Night Shift", th: "Dark · เรียลไทม์", note: "โหมดมืด เน้นไทม์ไลน์เหตุการณ์สด สัญญาณตะกร้า และตัวเลขแบบ monospace", swatch: ["#0f1211", "#c8f43a", "#7af0d0"] },
  { slug: "receipt", name: "Paper Receipt", th: "มินิมอล · ใบเสร็จ", note: "ตะกร้าคือใบเสร็จที่ค่อย ๆ พิมพ์ออกมา ตัวหนังสือใหญ่ ขาว-ดำ เรียบที่สุด", swatch: ["#f4f1ea", "#151515", "#d9472b"] },
  { slug: "bold", name: "Pop Blocks", th: "สนุก · กล้า", note: "Neo-brutalism ขอบหนา เงาออฟเซ็ต สีสด ปุ่มใหญ่กดง่าย เหมาะกับวัยรุ่น", swatch: ["#fff6e0", "#ffd23f", "#ff5c8a"] },
] as const;
