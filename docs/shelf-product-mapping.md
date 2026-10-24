# Shelf product mapping

- `SHELF-02`: ทุก valid lane (`LANE-1`, `LANE-2`, `LANE-COKE`, `LANE-WATER`) map เป็น `SPRITE_PLUS_TEA` / **Sprite Plus Tea** ก่อนเข้า FSM
- Firmware ส่ง `COKE` หรือ `WATER` ตาม lane เดิมได้ โดยเก็บเป็น `sourceSku` ใน event/audit; backend ใช้ SKU ใหม่สำหรับ Cart, Case, Agent history และ Checkout
- ยังคงตรวจ lane และความสอดคล้องของ SKU ที่ firmware ส่ง; canonical `SPRITE_PLUS_TEA` ก็รับได้สำหรับ Shelf 2
- `SHELF-01`: ทุก valid lane map เป็น `COKE` / **Cola** รวมสัญญาณจากช่องน้ำเดิม โดยเก็บ SKU ต้นทางเป็น `sourceSku` เมื่อมีการเปลี่ยน SKU
- ราคา Sprite เป็นราคาจำลอง 15 บาทตามรายการน้ำเดิม; Cola 25 บาทตามเดิม
- Shelf 3 ชื่อ **Fanta floral bloom** ยังเป็นการแสดงผลบนเว็บตามขอบเขตก่อนหน้า

ใช้ domain mapping เดียวกันทั้ง local API และ cloud IoT handler ไม่ต้อง flash firmware เพื่อเปลี่ยนชื่อสินค้า

## ข้อมูลเดิม

Product catalog เพิ่ม Sprite แบบรองรับ store เก่า โดยไม่ต้อง reset ข้อมูล

Mapping ใช้กับ event ใหม่หลัง API โหลดโค้ดใหม่นี้ ไม่แปลงย้อนหลัง Cart/Case/Order ที่ถูกบันทึกเป็น COKE/WATER ไปแล้ว เพราะตะกร้าเก่ารวมตาม SKU และไม่มี Shelf ต้นทางแยกครบทุกชิ้น การเดาจาก event ล่าสุดอาจเปลี่ยนยอดผิดรายการ

ถ้าจะสาธิตด้วยข้อมูลใหม่ ให้จบ/ตรวจรายการเก่า หรือใช้ Reset ใน Admin เมื่อพร้อมล้างข้อมูล โดยระบบไม่ reset ข้อมูลให้อัตโนมัติ
