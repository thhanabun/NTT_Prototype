# 📩 Project FAST: ขอข้อมูลจากทีม Tech

> **ไฟล์นี้คือ "ขอข้อมูลของจริงที่มีอยู่แล้ว" เพื่อเอาไปทำ Presentation ตอนนี้ ไม่ใช่ระดมไอเดีย**
> ผมจะเอาข้อมูลทั้งหมดไปทำ Presentation (PDF) + Project Summary + สคริปต์ Demo Video ส่งกรรมการ NTT DATA
> ขอเฉพาะสิ่งที่ **ทำแล้ว / ใช้อยู่จริง / วัดได้จริง** ยิ่งละเอียด คะแนนด้าน Tech ยิ่งเต็ม

---

## ⚠️ อ่านก่อน (สำคัญมาก)

1. **นอกจากคำถามและรูปที่ขอในไฟล์นี้ ถ้ามีอะไรที่ให้ได้อีก ให้ส่งมาให้หมดเลย**
   ไม่ว่าจะเป็นโค้ด, screenshot, log, ตัวเลขที่วัดได้, ไฟล์ diagram, ลิงก์, โน้ตที่จดไว้, ไอเดียที่ยังไม่เสร็จ
   **เอามาหมดเลย อย่าคัดทิ้ง** ผมคัดเองได้ แต่ถ้าไม่ส่งมา ผมจะไม่รู้ว่ามี
2. **ช่วยคิดด้วยว่ามีข้อมูล / ผลงานที่มีอยู่แล้วอะไรอีก ที่ใส่ใน Presentation ได้** แต่ไฟล์นี้ไม่ได้ถาม
   เช่น ฟีเจอร์ที่ทำแล้วแต่ไม่ได้บอก, บริการ AWS ที่ใช้อยู่แต่ไม่อยู่ในลิสต์, ตัวเลขที่วัดไว้แล้ว เขียนมาในหัวข้อ **"Z"** ท้ายไฟล์
3. ถ้าข้อไหน **ยังไม่ได้ทำ** ให้ตอบว่า "ไม่มี" ได้เลย **ไม่ต้องคิดหรือแต่งขึ้นมาใหม่** ไม่ต้องข้าม (ผมจะได้รู้ว่าไม่ต้องใส่ในสไลด์)
4. ถ้าข้อไหนมี **ตัวเลข** ขอแหล่งที่มาด้วย ว่า **วัดเองจากต้นแบบ** หรือ **อ้างอิงจากเว็บ/รายงาน** (ถ้าอ้างอิง ขอลิงก์)
5. ตอบในไฟล์นี้ได้เลย หรือส่งเป็นไฟล์แยก/โฟลเดอร์ก็ได้

---

## 📌 สิ่งที่กรรมการต้องการ (เพื่อให้รู้ว่าข้อมูลจะไปอยู่ตรงไหน)

**Presentation ต้องมี:** Project Name / Use Case Pain Point / AWS Solution / AWS Architecture & Services Used / Pricing / Cost Estimation / Before vs After Improvement

**Demo Video ≤ 10 นาที:** ภาพรวม, แนวทางแก้ปัญหา, **การใช้งาน AWS**, ผลลัพธ์

**เกณฑ์ตัดสินที่เกี่ยวกับ Tech:**
- **02 Agentic behavior:** ต้องเห็น task plan, tool/API call, **RAG result**, final output → คาดหวัง **RAG/custom chunking + use-case LLM + agentic agent**
- **03 Prototype completeness:** เดโมทำงาน end-to-end, มี UI → **ต้อง deploy บน AWS และแสดง cost efficiency**
- **04 Responsible AI:** guardrails, escalation flow, disclaimers, **audit trail**
- **06 Business value:** ตัวเลขก่อน/หลัง, benchmark

**Mentor (Coaching #2) แนะนำ:** ออกแบบ timestamp/payload, **ต้องมี authentication/login หน้าเว็บ**, เพิ่ม Route 53 / Amplify หรือ EC2 + CloudFront + WAF / API Gateway / S3 เก็บรูปสินค้า / RDS / วาด flow diagram เพิ่ม / **ใช้ Bedrock อย่างระวัง เพราะแพงสุด**

---

## 0. คำถามพื้นฐาน (ขอคำตอบก่อน)

- [ ] Frontend ใช้ framework อะไร? (React / Next.js / Vue / Flutter / อื่นๆ)
- [ ] Backend ภาษาอะไร? (Python / Node.js / อื่นๆ)
- [ ] ใช้ AWS Region ไหน? (Bangkok `ap-southeast-7` / Singapore `ap-southeast-1` / อื่นๆ)
- [ ] Bedrock model ที่ใช้คือตัวไหน? มีใน Region นั้นไหม?
- [ ] ชั้นวางเดโมมีกี่ช่อง / กี่ SKU / ESP32 กี่ตัว / กล้องกี่ตัว?
- [ ] Real-time push ไปมือถือใช้อะไร? (AppSync / API Gateway WebSocket / IoT MQTT over WebSocket)
- [ ] ใช้ RDS จริงไหม หรือ DynamoDB อย่างเดียว?
- [ ] ตอนนี้อะไร **deploy บน AWS แล้ว** / อะไร **ยังรันบนเครื่องตัวเอง**?
- [ ] ใช้ IaC ไหม? (CDK / Terraform / SAM / CloudFormation / คลิกใน Console)
- [ ] Repo อยู่ที่ไหน? (ขอลิงก์ GitHub ถ้ามี)

---

## 1. Hardware (ชั้น 1: ESP32 + Sensor + BLE)

**ขอข้อมูล**
- [ ] ลิสต์อุปกรณ์ทั้งหมด: รุ่น, จำนวน, ราคาที่ซื้อจริง (บาท), ร้านที่ซื้อ
- [ ] เซนเซอร์บนรางใช้แบบไหน? (limit switch / IR / ToF / load cell / อื่นๆ) ทำไมเลือกตัวนี้
- [ ] BLE: ใช้ beacon รุ่นอะไร ติดที่ตะกร้ายังไง, scan interval เท่าไหร่
- [ ] วิธีคำนวณว่าตะกร้าไหนอยู่หน้าชั้นวาง (RSSI threshold เท่าไหร่, ใช้ filter อะไร)
- [ ] กล้อง: รุ่นอะไร, ต่อกับอะไร, ถ่ายตอนไหน (ตลอด / เฉพาะ trigger)
- [ ] ESP32 เชื่อม IoT Core ด้วยวิธีไหน (MQTT + X.509 cert?) ทำสำเร็จแล้วหรือยัง
- [ ] ถ้าเน็ตหลุด ESP32 เก็บ event ไว้ได้ไหม กี่ตัว
- [ ] Power: ใช้ไฟจากอะไร
- [ ] ปัญหาที่เจอระหว่างทำ + วิธีแก้ (ใช้เล่าในพรีเซนต์ได้)

**ขอรูป**
- [ ] 📸 รูปชั้นวางเดโม (ทั้งชุด + ระยะใกล้ที่เซนเซอร์)
- [ ] 📸 รูปวงจร / wiring diagram / schematic
- [ ] 📸 รูป ESP32 + เซนเซอร์ที่ติดตั้งจริง
- [ ] 📸 รูปตะกร้า + BLE tag
- [ ] 🎥 คลิปสั้นตอนหยิบของแล้วไฟ LED ติด (ถ้ามี)

---

## 2. Payload & Timestamp Design (Mentor ขอ)

**ขอข้อมูล**
- [ ] ตัวอย่าง **JSON payload จริง** ที่ ESP32 ส่ง (copy มาทั้งก้อน)
- [ ] ความหมายของแต่ละ field
- [ ] ขนาด payload (bytes)
- [ ] MQTT topic ที่ใช้ (เช่น `fast/{store_id}/{shelf_id}/events`)
- [ ] QoS 0 หรือ 1? เพราะอะไร
- [ ] Timestamp: ใช้เวลาจาก ESP32 (NTP sync?) หรือเวลาที่ IoT Core รับ? คลาดเคลื่อนกี่ ms
- [ ] กัน event ซ้ำยังไง (มี `event_id` / idempotency ไหม)
- [ ] ถ้า event มาไม่เรียงลำดับ จัดการยังไง (มี `seq_no` ไหม)
- [ ] ความถี่ส่ง event / heartbeat
- [ ] ตัวอย่าง payload ของ event แต่ละแบบ: `PICK`, `PUT_BACK`, `RESTOCK`, `AMBIGUOUS`, `MISPLACED_ITEM`, heartbeat
- [ ] ตัวอย่าง output ของ Agent (decision, confidence, reason, evidence)

> ขอ payload ที่ใช้อยู่จริงในโค้ด (ไม่ต้องปรับให้สวย ส่งตามที่มี)

---

## 3. Cloud Backend (ชั้น 2: IoT Core → Lambda)

**ขอข้อมูล**
- [ ] ลิสต์ **AWS services ทั้งหมดที่ใช้จริง** + ใช้ทำอะไร
- [ ] ลิสต์ **Lambda functions ทั้งหมด**: ชื่อ, หน้าที่, runtime, memory, trigger จากอะไร
- [ ] IoT Rule ที่ตั้ง (SQL statement + action)
- [ ] ใช้ Kinesis จริงไหม? ถ้าไม่ใช้ ข้ามได้
- [ ] ใช้ Step Functions ไหม?
- [ ] ใช้ EventBridge / SQS / SNS ไหม? ทำอะไร
- [ ] Latency ที่วัดได้จริง: ESP32 → IoT Core → Lambda → DynamoDB → มือถือ (ms) **ขอตัวเลขวัดจริง**

**ขอรูป**
- [ ] 📸 Screenshot AWS Console: IoT Core (Things, Rules, MQTT test client ที่เห็น message เข้า)
- [ ] 📸 Screenshot Lambda functions list
- [ ] 📸 Screenshot CloudWatch Logs ตอนประมวลผล event

---

## 4. Deterministic FSM (ชั้น 3: ตัดสินเคสปกติ)

**ขอข้อมูล**
- [ ] State ทั้งหมดของ item/cart (เช่น `DETECTED → CONFIRMED / AMBIGUOUS → PENDING → CONFIRMED / REJECTED → PAID`)
- [ ] เงื่อนไขที่ถือว่า "ชัดเจน" vs "ไม่ชัดเจน" คืออะไร (กฎทั้งหมด)
- [ ] สูตรคำนวณ confidence score (น้ำหนักของ sensor / BLE / กล้อง)
- [ ] ทำไมเลือก threshold 90% / 70%
- [ ] % event ที่เป็นเคสปกติ vs คลุมเครือ จากการทดลองจริง (ทดลองกี่ครั้ง)
- [ ] Logic นี้รันที่ไหน (ESP32 / Lambda)
- [ ] โค้ดส่วน FSM (ขอไฟล์หรือ snippet)

**ขอรูป**
- [ ] 📸 State diagram (วาดมือถ่ายรูปมาก็ได้)

---

## 5. Cart (ชั้น 4)

**ขอข้อมูล**
- [ ] DynamoDB table ทั้งหมด: ชื่อ, partition key, sort key, ตัวอย่าง item
- [ ] ถ้าใช้ RDS: ER diagram / table + column, instance type, engine
- [ ] แบ่งข้อมูลยังไงระหว่าง DynamoDB กับ RDS? เพราะอะไร
- [ ] การคิดราคา + โปรโมชันทำที่ไหน
- [ ] Checkout ทำยังไง (จ่ายเงินจำลอง? payment gateway?)
- [ ] Exit gate ทำจริงหรือจำลอง

**ขอรูป**
- [ ] 📸 Screenshot DynamoDB items จริง
- [ ] 📸 Screenshot RDS (ถ้ามี)

---

## 6. Agentic AI (ชั้น 5) ⭐ สำคัญที่สุดสำหรับเกณฑ์ข้อ 02

**Agent**
- [ ] ใช้ Bedrock Agents / AgentCore / Strands / LangChain / เขียนเอง?
- [ ] มีกี่ agent ทำอะไรบ้าง (Supervisor / Arbitration / Merchandising / อื่นๆ)
- [ ] แต่ละ agent ใช้ model อะไร เพราะอะไร
- [ ] **System prompt / instruction** ของแต่ละ agent (copy มาเต็มๆ)
- [ ] Tools ทั้งหมด: ชื่อ, input, output, Lambda ที่อยู่เบื้องหลัง
- [ ] ตัวอย่าง **agent trace** จริง 1–3 เคส (plan → tool call → result → decision)
- [ ] เวลาที่ agent ใช้ตอบ 1 ครั้ง (วินาที)
- [ ] Token ที่ใช้ต่อ 1 ครั้ง (input / output / รูป)

**RAG (กรรมการระบุว่าต้องมี "RAG / custom chunking")**
- [ ] ทำ RAG แล้วหรือยัง? ใช้ Bedrock Knowledge Bases หรือทำเอง?
- [ ] เอกสารอะไรอยู่ใน knowledge base (catalog / planogram / SOP / นโยบายคืนเงิน / คู่มือ)
- [ ] Vector store ใช้อะไร (S3 Vectors / OpenSearch Serverless / pgvector / อื่นๆ)
- [ ] Chunking strategy อะไร + เหตุผล (fixed / semantic / hierarchical / custom)
- [ ] Embedding model อะไร รองรับภาษาไทยไหม
- [ ] ตัวอย่าง query → chunk ที่ดึงมา → คำตอบ

**Vision**
- [ ] ใช้ Bedrock multimodal / Rekognition / YOLO / โมเดลอื่น?
- [ ] ความแม่นยำที่ทดสอบได้ (ทดสอบกี่รูป ถูกกี่รูป)

**ลดค่า Bedrock (Mentor เตือน)**
- [ ] ทำอะไรไว้บ้างเพื่อลดค่าใช้จ่าย (เรียกเฉพาะเคสคลุมเครือ, model เล็ก, prompt caching, จำกัด token, ย่อรูป)
- [ ] ตั้ง AWS Budgets alarm ไว้ไหม

**ขอรูป**
- [ ] 📸 Screenshot Bedrock console (agent, action groups, knowledge base)
- [ ] 📸 Screenshot agent trace
- [ ] 📸 Screenshot ผล RAG

---

## 7. Human-in-the-Loop & Responsible AI (เกณฑ์ข้อ 04)

**ขอข้อมูล**
- [ ] Flow ถามลูกค้ายืนยันบนมือถือ (หน้าจอหน้าตาเป็นยังไง)
- [ ] Flow staff exception queue (ใครเห็น, กดอะไรได้บ้าง)
- [ ] ใช้ Bedrock Guardrails ไหม? ตั้งค่าอะไรบ้าง
- [ ] Audit log เก็บที่ไหน เก็บ field อะไรบ้าง (ขอตัวอย่าง record)
- [ ] เปิด CloudTrail ไหม
- [ ] Encryption: KMS / TLS
- [ ] IAM roles: แต่ละ Lambda มีสิทธิ์อะไร (least privilege ไหม)
- [ ] เก็บ secret/key ที่ไหน (Secrets Manager / Parameter Store / hardcode?)
- [ ] รูป evidence ใน S3 ลบเมื่อไหร่ ลบยังไง
- [ ] PDPA: มีหน้า consent ไหม, ข้อความ disclaimer ในแอปเขียนว่าอะไร
- [ ] กรณีระบบล่ม (เน็ตหลุด / เซนเซอร์เสีย) ทำยังไง

**ขอรูป**
- [ ] 📸 หน้า confirm บนมือถือลูกค้า
- [ ] 📸 หน้า exception queue ของ staff
- [ ] 📸 ตัวอย่าง audit log

---

## 8. Frontend & Authentication (ชั้น 6 + Mentor บอกว่าต้องมี login)

**ขอข้อมูล**
- [ ] Login ใช้ Amazon Cognito ไหม? แยกกลุ่ม customer / staff ยังไง
- [ ] ลูกค้า login ด้วยอะไร (เบอร์ OTP / Google / Guest) — staff login ด้วยอะไร, มี MFA ไหม
- [ ] Frontend host ที่ไหน (Amplify / S3 + CloudFront / EC2)
- [ ] มีโดเมนไหม (Route 53) — ชื่อโดเมน, มี SSL (ACM) ไหม
- [ ] ใช้ WAF ไหม เปิด rule อะไร
- [ ] API Gateway: REST / HTTP / WebSocket? ลิสต์ endpoint ทั้งหมด (method + path + ทำอะไร)
- [ ] API ใช้ Cognito authorizer ไหม
- [ ] รูปสินค้าเก็บ S3 + เสิร์ฟผ่าน CloudFront ไหม
- [ ] ลิงก์เว็บที่กรรมการกดเข้าไปลองได้ + บัญชีทดสอบ (ถ้ามี)

**ขอรูป**
- [ ] 📸 Screenshot ทุกหน้าของ Shopper App (login, cart, confirm, checkout, receipt)
- [ ] 📸 Screenshot ทุกหน้าของ Admin/Staff Dashboard
- [ ] 📸 Screenshot Cognito user pool, Amplify/CloudFront, Route 53, WAF, API Gateway

---

## 9. Architecture & Flow Diagrams (Mentor ขอเพิ่ม)

**ขอไฟล์ (draw.io / Lucidchart / Figma / รูปภาพ อะไรก็ได้)**
- [ ] AWS Architecture Diagram ทั้งระบบ (ถ้ามี AWS icons จะดีมาก)
- [ ] Flow: เคสปกติ (หยิบ → cart อัปเดต)
- [ ] Flow: เคสคลุมเครือ (→ Agent → HITL)
- [ ] Flow: login + เริ่ม session
- [ ] Flow: checkout + exit gate
- [ ] Flow: วางคืนผิดช่อง
- [ ] Flow: restock
- [ ] Network/security diagram (Route 53 → WAF → CloudFront, API Gateway + Cognito, VPC ของ RDS)
- [ ] แยก diagram "ที่ทำจริงในเดโม" vs "ที่จะทำตอน scale" (ถ้ามี)

> วาดมือแล้วถ่ายรูปมาก็ได้ ผมเอาไปวาดใหม่ให้สวยเอง

---

## 10. Pricing / Cost (เกณฑ์ข้อ 03: ต้องแสดง cost efficiency)

**ขอข้อมูล**
- [ ] **ค่า AWS ที่จ่ายจริง** ตอนนี้ (screenshot Billing / Cost Explorer)
- [ ] ลิงก์ **AWS Pricing Calculator** (ถ้าทำแล้ว)
- [ ] สมมติฐาน: ลูกค้า/วัน, PICK/วัน, % ที่เรียก Bedrock, จำนวน ESP32/shelf
- [ ] ราคาต่อเดือนของแต่ละบริการ (IoT Core, Lambda, API Gateway, DynamoDB, RDS, S3, CloudFront, WAF, Route 53, Cognito, Bedrock, vector store, CloudWatch, AppSync)
- [ ] ประมาณค่าใช้จ่าย 3 ระดับ: เดโม / 1 สาขา / 100 สาขา
- [ ] ค่าฮาร์ดแวร์ต้นแบบรวม (บาท) + ประมาณต่อ 1 สาขาจริง
- [ ] ใช้ Free Tier / credits อะไรอยู่

**ขอรูป**
- [ ] 📸 Screenshot Billing / Cost Explorer
- [ ] 📸 Screenshot AWS Budgets (ถ้าตั้ง)

---

## 11. Before vs After / ผลทดสอบ (เกณฑ์ข้อ 06)

**ขอตัวเลขที่วัดจากต้นแบบจริง**
- [ ] Latency end-to-end (หยิบ → เห็นบนมือถือ) เฉลี่ย / ต่ำสุด / สูงสุด
- [ ] ความแม่นยำตรวจ PICK / PUT_BACK (ทดลอง N ครั้ง ถูกกี่ครั้ง)
- [ ] % event ที่ต้องส่งไป Agent
- [ ] ความแม่นยำของ Agent ในเคสคลุมเครือ
- [ ] เวลา checkout ในเดโม vs เวลาต่อคิวจริง (ถ้าไปจับเวลาร้านจริงได้จะดีมาก)
- [ ] ค่า cloud ต่อ 1,000 transactions
- [ ] Load/stress test (ถ้าทำ): ส่ง event พร้อมกันกี่ตัว ระบบไหวไหม

**ขอข้อมูลอ้างอิง (ถ้ามี) + ลิงก์**
- [ ] เวลารอคิวร้านสะดวกซื้อในไทย
- [ ] ต้นทุนระบบ Amazon Just Walk Out
- [ ] ความสูญเสียจาก phantom inventory
- [ ] ค่าแรงพนักงานร้านสะดวกซื้อไทย 2026

---

## 12. Demo Video (≤ 10 นาที)

- [ ] มีฟุตเทจอะไรถ่ายไว้แล้วบ้าง? (ส่งมาทั้งหมด แม้จะยังไม่ตัดต่อ)
- [ ] Screen recording ของแอป + AWS Console
- [ ] ใครเป็นคนพูด / ตัดต่อ ใช้โปรแกรมอะไร
- [ ] จะอัปโหลดที่ไหน (YouTube unlisted / Google Drive) — ต้องเปิดได้โดยไม่ต้องขอสิทธิ์

**ฉากที่ต้องมีในวิดีโอ (ถ่ายเผื่อไว้)**
- [ ] Login ลูกค้า + login staff
- [ ] หยิบของจริง → cart บนมือถืออัปเดต
- [ ] วางคืน → cart ลด
- [ ] เคสคลุมเครือ → agent trace / tool call / RAG → ถามลูกค้า หรือเข้า staff queue
- [ ] Staff อนุมัติ → audit log บันทึก
- [ ] Item pending ไม่ถูกคิดเงิน (guardrail)
- [ ] AWS Console จริง (IoT Core message เข้า, DynamoDB อัปเดต, CloudWatch logs, Bedrock trace)
- [ ] Checkout + receipt

---

## 13. ไฟล์อื่นๆ ที่ส่งมาได้ (ส่งมาหมดเลย)

- [ ] โค้ดทั้งหมด (ลิงก์ repo หรือ zip)
- [ ] ไฟล์ IaC / config
- [ ] ไฟล์ diagram ต้นฉบับ (.drawio, .fig ฯลฯ)
- [ ] รูป / วิดีโอระหว่างทำงานทั้งหมด (behind the scenes ใช้เล่า storytelling ได้)
- [ ] โน้ตจากการคุยกับ mentor ครั้งอื่นๆ
- [ ] ไฟล์ทดลอง / ตารางผลทดสอบ / log
- [ ] ปัญหาที่เจอ + วิธีแก้
- [ ] Roadmap ที่ทีมวางไว้แล้ว (ถ้ามี)

---

## Z. ข้อมูลที่มีอยู่แล้ว แต่ไฟล์นี้ไม่ได้ถาม 📎

> **ช่วยคิดว่ามีอะไรที่ทำไปแล้ว / มีอยู่แล้ว ที่ควรอยู่ใน Presentation อีก**
> เช่น ฟีเจอร์ที่ทำแล้วแต่ไม่ได้บอก, บริการ AWS ที่ใช้อยู่, ตัวเลขที่วัดไว้แล้ว, จุดเด่นของงานที่ทีมคิดว่ากรรมการควรเห็น

1.
2.
3.
4.
5.

---

### 🔁 ย้ำอีกครั้ง

**นอกจากคำถามและรูปที่ขอในไฟล์นี้ อะไรที่ให้ได้ เอามาหมดเลย**
**และช่วยคิดว่ามีข้อมูลที่มีอยู่แล้วอะไรอีก ที่ใส่ใน Presentation ได้**
**ข้อมูลนี้เอาไปทำ Presentation จริง ไม่ใช่ระดมไอเดีย: ขอเฉพาะของที่ทำแล้ว / วัดได้จริง**

ขอบคุณครับ 🙏
