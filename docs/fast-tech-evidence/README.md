# หลักฐานประกอบ FAST Tech Data Response

ไฟล์หลักฐานนี้รองรับคำตอบ snapshot เดิม; สถานะ Cloud ปัจจุบันอาจเปลี่ยนแล้ว ให้ยึด [cloud-deployment-status.md](../cloud-deployment-status.md) สำหรับ resource/release ล่าสุด และอย่าใช้ภาพหรือรายงาน fixture เป็นหลักฐาน Cloud E2E.

อ่านไฟล์ [FAST_Tech_Data_Response.md](../../FAST_Tech_Data_Response.md) ที่ root ของโครงการเป็นหลัก

- `reports/`: รายงานที่คัดจากการทดสอบเดิม 14 ชุด พร้อมตัวเลขที่คำนวณจากรายงานและตัวอย่าง audit อีก 2 ไฟล์
- `screenshots/`: ภาพที่มีอยู่แล้ว 38 ไฟล์ แยก local UI, actual ESP telemetry, real Laya with mock signals, statistics และ cloud fixtures
- `inventory.json`: แหล่งที่มาของแต่ละไฟล์และประเภทหลักฐาน
- `document-check.json`: ผลตรวจว่าตอบครบ 157 รายการ ลิงก์ไม่ขาด และ Markdown code fences ปิดครบ
- `FAST_Tech_Data_Request.md`: สำเนาคำถามต้นฉบับสำหรับเทียบรายการ

เมื่อส่งต่อให้ทีม ให้นำไฟล์ Markdown ที่ root และโฟลเดอร์นี้ไปด้วย โดยคงโครงสร้าง `docs/fast-tech-evidence/` ไว้ ลิงก์ไป source code อื่นต้องเปิดร่วมกับ repository

ชุดนี้ไม่ได้รันทดสอบระบบใหม่ ไม่ได้เข้าบัญชี AWS และไม่ใช่หลักฐานว่า deploy แล้ว รายงานและภาพระบุขอบเขต mock/real/local/cloud prepared ในคำตอบหลัก
