# Single-basket clear pick

FSM และ Agent evidence ใช้ policy เดียวกันใน `src/proximity-policy.mjs`

## เห็น RSSI เพียงตะกร้าเดียว

Clear ได้เมื่อ:

- มี active session เพียงใบเดียว และตรงกับ tag ที่พบ
- RSSI ของ tag นั้น >= `SINGLE_BASKET_MIN_RSSI` (ค่าเริ่มต้น **-80 dBm** รวม -80 พอดี)
- Event ไม่ถูกระบุว่า delayed
- ถ้าเป็น PUT_BACK ต้องมีสินค้านั้นอยู่ในตะกร้าด้วย

กรณีนี้ FSM อัปเดตตะกร้าโดยไม่เรียก Agent และ audit `CART_UPDATED` ระบุ `selectionBasis: SINGLE_ACTIVE_BASKET`

ไม่มี session, มีสอง session แต่หายไปหนึ่ง tag, tag ที่พบไม่ตรงกับ session หรือ RSSI อ่อนกว่าเกณฑ์ → `ZONE_UNKNOWN` → Staff ตรวจ

## เห็น RSSI สองตะกร้า

ใช้ส่วนต่าง 10 dB ตามเดิม; ส่วนต่างน้อยกว่านั้นส่ง Agent และยังต้องผ่าน customer/staff confirmation

## เปลี่ยนเกณฑ์

ตั้งใน terminal ของ API ก่อน `npm start`:

```powershell
$env:SINGLE_BASKET_MIN_RSSI = "-80"
npm start
```

ตัวเลขยิ่งติดลบมาก ยิ่งรับ tag ที่สัญญาณอ่อนกว่าได้ ค่าเริ่มต้นนี้เป็นเกณฑ์เดโมที่ยังต้องปรับเทียบกับตำแหน่งตะกร้าและชั้นจริง ไม่ใช่ระยะทางที่วัดเป็นเมตร

เคสเดิมยังเป็นประวัติเดิม ไม่มีการย้ายรายการหรือปิดเคสย้อนหลังอัตโนมัติ
