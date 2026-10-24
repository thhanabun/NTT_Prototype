# Admin: real customer recording

เพิ่มเติม: [กล้องสดและคำสั่งแชต Admin](admin-controls-camera.md) รองรับกล้องบนเครื่องที่เปิด Admin พร้อมปรับเทียบแผนที่ใหม่ตามมุมกล้อง

หน้า Admin ใช้คลิป `IMG_0465.MOV` แทนวิดีโอวาดจำลอง พร้อมกรอบ Customer, Basket A/B, Shelf 1–3, แผนที่จุด/เส้นทาง และ Heatmap ที่อิงเวลาเดียวกับวิดีโอ

## การประมวลผล

- YOLO11n ตรวจ COCO class `person` แล้วแสดงชื่อ `Customer`; ByteTrack ติดตามต่อเนื่อง
- ประมวลผลบน CPU ในเครื่องที่ 10 samples/วินาที ได้ 442 samples จากคลิปประมาณ 44.2 วินาที
- คลิปผลลัพธ์ 1280×720, 15 FPS, VP9 WebM ไม่มีเสียง ประมาณ 3.3 MB กรอบในวิดีโอใช้ sample ล่าสุดก่อนเวลาภาพ (ไม่เกินประมาณ 0.1 วินาที)
- **คนแรกที่เดินเข้ามา กางเกงขาสั้น = Basket B**: raw track 1 และ track 12 ที่ขอบภาพช่วงท้าย
- **คนที่สอง กางเกงขายาว = Basket A**: raw track 2
- การผูก B/A มาจากคำกำหนดของผู้ใช้และการตรวจภาพ ไม่ใช่การอนุมานตะกร้าจาก BLE หรือการจดจำใบหน้า
- ตรวจพบ false person track 3 บนโน้ตบุ๊ก Shelf 1 ช่วง 4.1–4.5 วินาที จึงไม่แสดง track นี้ รายการยกเว้นบันทึกใน calibration และ metadata
- Play/Pause/seek/loop ใช้ video media time เดียวกันกับแผนที่ เส้นทางแสดงย้อนหลัง 6 วินาที; Heatmap สะสมจากต้นคลิปถึงเวลาปัจจุบัน ตัวอย่างตำแหน่งทุก 0.5 วินาที
- ช่วงที่ไม่มี detection ไม่สร้างตำแหน่งจำลอง และไม่ลากเส้นเชื่อมข้ามช่วงข้อมูลหาย

## Calibration กล้องมุมเอียง

1. ประมาณจุดบนพื้น 4 จุดใน reference frame แล้วใช้ floor homography ฉายลงผัง normalized 0–1
2. Shelf 1, 2, 3 เรียงซ้ายไปขวาตามโต๊ะจริง ใช้พื้นที่ขาโต๊ะบนพื้นประมาณจากภาพ
3. หา ORB features บนฉากหลังโดย mask คนออก และ RANSAC homography จัดภาพแต่ละ sample กลับไป reference frame เพื่อลดผลจากกล้องถือที่เคลื่อน
4. ใช้กึ่งกลางขอบล่างกรอบเป็นจุดเท้า แล้วฉายผ่าน camera alignment และ floor homography
5. หาก alignment ไม่ผ่านหรือจุดอยู่นอกขอบผัง จะไม่วาดจุดบนแผนที่ คลิปนี้หา alignment ได้ครบ 442 samples; ตัวเลขนี้ไม่ได้ยืนยันความแม่นยำทางกายภาพ

**ขอบเขต:** ไม่มีระยะวัดจริง, camera intrinsics หรือ lens calibration ดังนั้นผังเป็นตำแหน่งประมาณจากภาพ ไม่ใช่มาตราส่วนเมตร; parallax, wide-angle distortion และการบังเท้ายังทำให้พิกัดคลาดเคลื่อนได้ เปลี่ยนกล้อง/มุมต้องปรับจุดอ้างอิงใหม่

## ไฟล์และการสร้างใหม่

- `tools/process-customer-clip.py`: inference, tracking, camera alignment, projection, annotations และ encoding
- `infra/vision/customer-clip-calibration.json`: จุดอ้างอิงพื้น, โต๊ะ, raw track → Basket mapping และ track ที่ตรวจแล้วตัดออก
- `web/src/lib/customer-tracking-recording.json`: metadata และ detections จากคลิปจริง มี source/model SHA-256 เพื่อระบุที่มา
- `web/src/lib/customer-tracking.ts`: เวลา sample และเส้นทางที่ไม่เชื่อมข้ามข้อมูลหาย
- `web/src/components/admin/customer-detection.tsx`: player และแผนที่ซิงก์ตามเวลา
- `web/public/vision/customer-detection.webm` / `.jpg`: วิดีโอพร้อมกรอบและ poster; Docker Web เดิมคัดลอก public อยู่แล้ว

ติดตั้ง dependency และประมวลผลจาก repo root:

```powershell
.\.venv-vision\Scripts\python.exe -m pip install -r requirements-vision.txt
.\.venv-vision\Scripts\python.exe -u tools/process-customer-clip.py 'C:\Users\thana\Downloads\IMG_0465.MOV'
# ตรวจ raw tracks และแก้ basketAssignments / floor anchors ใน calibration ก่อน render คลิปใหม่
.\.venv-vision\Scripts\python.exe -u tools/process-customer-clip.py 'C:\Users\thana\Downloads\IMG_0465.MOV' --render
```

ใช้ weights YOLO11n ที่ pin hash ใน `infra/vision/assets.json` และเตรียมไว้ใน `data/vision/yolo11n.pt` เช่นเดียวกับ vision service เดิม Cache detections เก็บใน `data/vision/customer-clip-detections.json` ซึ่งถูก gitignore; ไม่คัดลอกคลิป MOV ต้นฉบับเข้าที่เก็บ Git

แสดงผลที่หน้า Admin โดยใช้คำสั่งเปิด Web เดิม (`npm run dev:mock` ใน `web` สำหรับ local mock login) ไม่ต้องเริ่ม API ใหม่สำหรับการเปลี่ยนคลิปนี้

## การเชื่อมกับระบบร้าน

ส่วนนี้เป็น **recorded replay** จาก inference จริง ไม่ใช่ RTSP/live camera และยังไม่ใช้ยืนยัน PICK/PUT_BACK หรือเปลี่ยน cart/checkout การส่งเป็น Agent evidence ต้องผูก event/camera/timestamp และตรวจความสดของหลักฐานแยกก่อนใช้ service ตรวจภาพเดี่ยวเดิมยังคงทำงานแยกตามเดิม

ตรวจ TypeScript, lint ของ source ที่แก้ และ production build ผ่านแล้ว ตรวจภาพกรอบ/ID และดู player พร้อม map/Heatmap ใน browser แล้ว ไม่ได้รันชุดทดสอบ E2E ทั้งระบบในงานเปลี่ยนคลิปนี้
