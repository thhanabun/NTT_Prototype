# Admin: Customer detection preview

หน้า Admin มี Object Detection ต่อจากส่วน Shelf/Basket พร้อมวิดีโอ, class `Customer`, track ID, แผนที่จุด/เส้นทาง และ Heatmap

## สถานะปัจจุบัน

- **MOCK ทั้งภาพและ track**: คลิปภาพวาดจำลอง 24 วินาที / 3 Customers ไม่ใช่ผล YOLO หรือวิดีโอกล้องจริง
- กด Play/Pause หรือเลื่อนเวลาในวิดีโอ แผนที่และกรอบ Customer ใช้เวลาเดียวกับวิดีโอ; เริ่มรอบใหม่จะเริ่ม Heatmap รอบใหม่
- Heatmap แสดงการสะสมตำแหน่งตั้งแต่ต้นคลิปถึงเวลาที่เล่นอยู่ (ตัวอย่างทุก 0.5 วินาที) ไม่ใช่สถิติของร้านจริง
- ID 001–003 เป็น track ID จำลอง ไม่ได้ระบุตัวบุคคลหรือผูกกับ Basket A/B
- ไม่ส่งข้อมูลเข้า FSM, cart หรือ Agent evidence และไม่เปลี่ยนข้อมูลการซื้อ
- ไม่ใช้โมเดลหรือ dependency ใหม่ในหน้าเว็บ; YOLO11n evidence tool เดิมยังทำงานแยกตามเดิม

## ไฟล์

- `web/src/components/admin/customer-detection.tsx`: player, bounding boxes และแผนที่ซิงก์ตาม video media time
- `web/src/lib/customer-tracking-demo.json`: จุดเส้นทางจำลอง ใช้ร่วมกันระหว่างตัวสร้างคลิปและ UI
- `web/src/lib/customer-tracking-demo.ts`: interpolation และพิกัดภาพจำลอง
- `web/public/demos/customer-walk.webm` / `.jpg`: วิดีโอ VP8 และภาพเริ่มต้น เสิร์ฟจาก Next.js public; Docker Web เดิมคัดลอก public อยู่แล้ว

สร้างวิดีโอใหม่หลังแก้ fixture (จาก repo root):

```powershell
.\.venv-vision\Scripts\python.exe tools/generate-customer-demo.py
```

## เมื่อได้คลิปจริง

1. ใช้คลิปจากมุมกล้องที่จะติดตั้ง พร้อมขนาดภาพและ FPS; ขอผังร้านหรือระยะอ้างอิงด้วย
2. ใช้ YOLO11n ตรวจ class `person` และแสดงเป็น `Customer`; เพิ่ม tracking เพื่อให้ ID ต่อเนื่องข้ามเฟรม (ปัจจุบัน service เดิมตรวจภาพเดี่ยว ยังไม่ทำ video tracking)
3. เลือกคู่จุดอ้างอิงบนพื้นกล้องกับผังอย่างน้อย 4 จุด แล้วคำนวณ homography; ใช้กึ่งกลางขอบล่าง bounding box เป็นจุดเท้าฉายลงผัง
4. เปลี่ยน fixture เป็นผลจริงที่มี `timestamp`, `trackId`, `box`, `footPoint`, `mapPoint`; ซิงก์กับเวลาในคลิป และทบทวนการบังกัน/หลุดเฟรมก่อนใช้ Heatmap จริง
5. เอาป้าย MOCK ออกเมื่อทั้ง detection/tracking และการฉายพิกัดใช้ข้อมูลจริงแล้วเท่านั้น; การเชื่อมเป็น Agent evidence ต้องมี event/camera/timestamp alignment แยกต่างหาก

ผังทั้ง 3 Shelf และการฉายพิกัดในเวอร์ชันนี้เป็นเพียงตัวอย่าง ยังไม่ได้ปรับเทียบกล้องจริง
