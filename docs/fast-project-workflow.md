# FAST Smart Basket - Project Workflow and AWS Architecture

**เอกสารภาพรวมระบบและ workflow**
Workflow นี้เทียบกับ [`main` ที่ commit `ebb5570`](https://github.com/thhanabun/NTT_Prototype/commit/ebb55707cadc1dbecb3732a34f8769460f8967d1) เมื่อ 19 พฤศจิกายน 2026 ส่วนสถานะ AWS อ้างอิง [บันทึก Cloud](cloud-deployment-status.md) วันที่ 17 พฤศจิกายน 2026

[PDF สำหรับนำเสนอฉบับก่อนปรับ workflow](../output/pdf/fast-project-workflow.pdf)

เอกสารนี้อธิบายตั้งแต่ลูกค้าเริ่มใช้ตะกร้า การตรวจจับสินค้า การตัดสินใจของ FSM และ Agent ไปจนถึงข้อมูล, realtime, audit และ AWS services โดยแยกสถานะของโค้ดออกจากสถานะ Cloud ที่ deploy จริง

### สถานะตามบันทึก Cloud 17 พ.ย. 2026

- AWS stack `fast-prototype` ใน NTT Team 14 / Singapore deploy แล้ว; IoT เปิดใช้งานและ provision credentials/policies ให้ Shelf 1–3.
- Web/Admin, Shopper, API, Agent runtime, DynamoDB, Step Functions, Bedrock, realtime, audit/archive และ monitoring resources ถูก deploy ตาม [รายงานสถานะ](cloud-deployment-status.md).
- ยังไม่มีหลักฐานใน repo สำหรับ full Cloud E2E, physical E2E ครบสามบอร์ด, measured AWS bill/latency หรือ camera accuracy. Resource status ไม่ใช่ผล acceptance.

บน `main` นั้น `/events` และ `/telemetry` ยังเข้าผ่าน IoT Topic Rule และ Ingest Lambda ตัวเดียวกัน แล้วจัดเก็บใน `StateTable` ตามประเภทของข้อความ การแยกเป็น `TelemetryRule`, `TelemetryFunction` และ `TelemetryTable` พร้อม TTL ประวัติ 1 ชั่วโมงอยู่ใน branch [`fix/cloud-telemetry-isolation` ที่ commit `2160010`](https://github.com/thhanabun/NTT_Prototype/commit/2160010c3d84d6b002ddf3671afe57660f63e13e) ซึ่งยังไม่ได้รวมเข้า `main` ที่ตรวจ

## 1. ภาพรวมโครงการ

FAST เป็น prototype ร้านค้าขนาดเล็กที่รองรับตะกร้า 2 ใบ (Basket A/B) และ Shelf ID 3 จุด ลูกค้าสแกน QR เพื่อผูก session กับตะกร้าและดู cart ของตน พนักงานใช้ Admin เพื่อตรวจ shelf, ตรวจ Agent case, ทำ HITL และดูข้อมูลยอดขาย

กติกาควบคุมหลักมี 3 ข้อ:

1. **Backend ตรวจทุกการเปลี่ยน cart** โดยใช้กฎ event ID, shelf/lane/SKU, session และ quantity เคสกำกวมต้องได้รับการยืนยันจากลูกค้าหรือพนักงานตามสิทธิ์
2. **Admin Agent ตรวจเฉพาะเคสกำกวม** และเสนอแนะจากเครื่องมืออ่านหลักฐาน ส่วน Shopper Agent ตอบคำถามร้านและตะกร้าผ่านเครื่องมืออ่านข้อมูล ทั้งสอง Agent ไม่มีสิทธิ์เปลี่ยน cart โดยตรง
3. **รายการที่ยังไม่ยืนยันไม่คิดเงิน**: `PENDING`, `CONFLICT`, เคสที่ยังเปิด หรือหลักฐานไม่พอ จะไม่รวมใน payable total; การชำระเงินจริงอยู่นอกขอบเขตและ checkout เป็น mock

### สถานะที่ใช้ในภาพรวม

| สถานะ | ความหมาย |
| --- | --- |
| **Deployed** | มีอยู่ใน Cloud stack ที่บันทึกว่า `fast-prototype` สำเร็จ |
| **Optional / prepared** | มีโค้ดและ parameter สำหรับ deploy แต่ปิดไว้ใน stack ปัจจุบัน |
| **Local** | ทำงานในเครื่องสำหรับพัฒนาและทดสอบ |
| **Pending acceptance** | โค้ด/ทรัพยากรมี แต่ยังไม่มีหลักฐานทดสอบ E2E จริงครบ |

```mermaid
flowchart LR
  Customer[ลูกค้า / มือถือ] --> QR[สแกน QR Basket A หรือ B]
  QR --> Shopper[Shopper PWA / session และ cart]
  Staff[พนักงาน] --> Admin[FAST Admin Dashboard]
  Device[ESP32 + switch + BLE] --> Ingest[IoT Core + Ingest Lambda]
  Simulator[Admin mock signal] --> API
  Shopper --> BFF[HTTPS same-origin BFF]
  Admin --> BFF
  BFF --> API[API Gateway + API Lambda]
  API -->|Shopper Chat| Chat[Shopper Agent / Bedrock + read-only tools]
  Ingest -->|Shelf event| FSM[Deterministic cart rules]
  Ingest -->|Telemetry| State[(State / cart / case / audit)]
  API --> FSM
  FSM --> State
  FSM -->|Unresolved case| Workflow[Step Functions]
  Workflow -->|Ambiguous case| Agent[Bedrock planner + private Agent runtime]
  Agent --> Evidence[Evidence tools / Laya / YOLO]
  Evidence --> Agent
  Agent --> Workflow
  Workflow --> HITL[Customer หรือ Staff ยืนยัน]
  HITL -->|Human decision| API
  API -->|Task callback after persist| Workflow
  State --> Notify[WebSocket invalidation]
  Notify --> Shopper
  Notify --> Admin
```

ณ 17 พ.ย. 2026 Cloud stack มี Web, API, Agent, DynamoDB, Cognito, Step Functions, WebSocket และ operational services; `EnableIoT=true`. Thing/certificate/policy สำหรับ Shelf 1–3 ถูก provision แล้ว. การ provision ไม่ยืนยันว่า board ถูก flash หรือ physical IoT E2E ผ่าน จึงต้องแยกสถานะ resource ออกจากผลทดสอบ hardware.

## 2. ผู้ใช้, หน้าจอ และขอบเขตความรับผิดชอบ

### Shopper PWA

- สแกน QR เพื่อผูก Basket A/B และเริ่ม session
- ดูรายการที่ยืนยันแล้ว, จำนวน, ราคา, ยอดรวม และสถานะรายการที่กำลังตรวจ
- รับ state-change ผ่าน WebSocket แล้วเรียก API เพื่ออ่าน snapshot ที่ตนมีสิทธิ์เห็น
- ตอบ YES/NO เมื่อระบบเสนอให้ยืนยันรายการ; NO หรือไม่ตอบจะไป Staff
- ทำ mock checkout ได้เมื่อมีแต่รายการที่ยืนยันแล้วและไม่มี case ที่ขวาง cart
- ใช้ **Shopper Agent** ถามวิธีใช้ร้าน สินค้า และสถานะตะกร้าของตน ระบบตอบพร้อมแหล่งอ้างอิงจากเครื่องมืออ่านข้อมูล

### Staff Admin

- **Monitor:** สถานะ shelf/device, RSSI, lane, event ล่าสุด, FSM state, cart และเคสเปิด
- **Agent Case Monitor:** evidence, tool calls, confidence, recommendation, next action และ timeline
- **HITL:** เลือก Basket A/B แล้ว Approve หรือ Reject; backend ตรวจสิทธิ์และเงื่อนไขซ้ำก่อนเขียน cart
- **Object Detection:** คลิปบันทึกพร้อมกรอบ/แผนที่/heatmap และกล้องของอุปกรณ์ที่เปิด Admin
- **Stat Query:** ขอ daily sales หรือ top products; Laya เลือก query/view แบบมีขอบเขต แล้ว backend aggregate ข้อมูลและ UI วาดกราฟ
- **Reset:** เครื่องมือ Admin สำหรับล้าง demo state ตาม policy ของแอป; reset Cloud ถูกปิดไว้ใน deployment ปัจจุบัน

### Shelf และสินค้า

| Shelf | ชื่อที่แสดง | Mapping ที่ตรวจพบใน backend |
| --- | --- | --- |
| Shelf 1 / `SHELF-01` | Cola | ทุก valid lane map เป็น `COKE` / Cola |
| Shelf 2 / `SHELF-02` | Sprite Plus Tea | ทุก valid lane map เป็น `SPRITE_PLUS_TEA`; เก็บ SKU ต้นทางใน audit |
| Shelf 3 / `SHELF-03` | Fanta floral bloom | ชื่อแสดงผลบนเว็บ ส่วน backend ใช้ SKU ตาม lane เดิม |

UI รองรับ Shelf 1–3 ทั้งหมด ส่วนสถานะ **ONLINE** ต้องมาจาก telemetry ของอุปกรณ์จริง ไม่ได้เกิดจากการแสดง shelf หรือ simulator

## 3. Hardware signal → cart (Local และ Cloud)

### Hardware ที่กำหนดสำหรับ prototype

- ESP32-WROOM-32
- KW11-N/KW12 roller microswitch สำหรับ lane ที่ติดตั้ง
- iBeacon Bluetooth IP67: Basket A, Basket B และ HV-001 (tag อ้างอิง; HV-001 ไม่ใช่สินค้าใน cart)
- Firmware บน Arduino core ใช้ debounce 80 ms เมื่อสถานะสินค้าเปลี่ยนจากมีเป็นว่างจะส่ง `PICK` และเมื่อเปลี่ยนจากว่างเป็นมีจะส่ง `PUT_BACK`
- ESP32 ใช้ RSSI (Received Signal Strength Indicator) เพื่ออ่านความแรงสัญญาณ BLE ของแต่ละ tag ในหน่วย dBm เช่น −55 dBm แรงกว่า −57 dBm ค่าที่ใช้คือ median จากตัวอย่างสดสูงสุด 5 ค่าในช่วง 5 วินาที ถ้าไม่มีตัวอย่างสดจะส่ง `null`
- Event มี `eventId` และเก็บใน RAM outbox ได้สูงสุด 8 รายการ Firmware ส่งซ้ำด้วย ID เดิมประมาณทุก 3 วินาทีเมื่อเชื่อมต่อและยังไม่ได้ application ACK ถ้าคิวเต็ม รายการใหม่อาจตกหล่น และคิวใน RAM จะหายเมื่อบอร์ดรีสตาร์ต

ใต้ MQTT prefix `smartbasket/shelf/{shelfId}/` มีสาม topic:

| Topic | ข้อมูลและทิศทาง |
| --- | --- |
| `events` | ESP32 ส่ง `eventId`, `shelfId`, `laneId`, `sku`, `eventType`, `timestamp`, `delayed` และ RSSI ของ A/B/HV01 |
| `telemetry` | ESP32 ส่ง heartbeat ประมาณ 1 Hz ขณะเชื่อมต่อ พร้อม RSSI, สถานะ asset tag, uptime, queue depth และ dropped count ส่วน lane/switch state เป็นฟิลด์เสริมในบาง payload เช่น local firmware |
| `acks` | Backend ส่ง `eventId` กลับไปให้ ESP32 หลังบันทึก event และเริ่ม workflow ถ้าต้องใช้ จากนั้น ESP32 นำรายการที่ตรงกันออกจาก outbox |

Cloud firmware ใช้ MQTT over TLS พอร์ต 8883 พร้อม X.509 certificate ของอุปกรณ์ Ingest Lambda ตรวจว่า shelf ID ใน MQTT topic, client ID และ payload ตรงกัน

```mermaid
flowchart TD
  Switch[Microswitch / product present] --> Debounce[ESP32 debounce และ transition]
  Beacon[BLE tags A / B / HV01] --> Filter[RSSI median + freshness]
  Debounce --> Event[สร้าง PICK หรือ PUT_BACK]
  Filter --> Event
  Event --> Outbox[RAM outbox + retry eventId เดิม]
  Outbox --> LocalMQTT[Local MQTT broker / bridge]
  LocalMQTT --> LocalAPI[Node API :3000]
  LocalAPI --> LocalFSM[Schema + dedupe + mapping + FSM]
  LocalFSM --> LocalStore[JSON file หรือ DynamoDB adapter]
  LocalStore --> SSE[Native SSE]
  SSE --> LocalWeb[Next.js PWA :3001]
  Outbox -->|events| IoT[AWS IoT Core MQTT/TLS + X.509]
  Heartbeat[ESP32 heartbeat ประมาณ 1 Hz] -->|telemetry| IoT
  IoT --> Rule[IoT Topic Rule]
  Rule --> Ingest[IngestFunction Lambda]
  Ingest -->|events| CloudFSM[Shared domain/FSM]
  CloudFSM --> CloudDB[(DynamoDB StateTable)]
  Ingest -->|telemetry records| CloudDB
  Ingest -->|Event ACK ผ่าน IoT Core| Device[ESP32]
  CloudDB --> Stream[DynamoDB Streams]
  Stream --> Changes[ChangesFunction Lambda]
  Changes --> WS[API Gateway WebSocket]
  WS --> CloudWeb[Cloud Shopper / Admin]
```

### การตัดสินใจ deterministic

1. ตรวจ schema, shelf/lane/SKU ที่อนุญาต และ `eventId`; event ID ที่เคยรับแล้วจะไม่เพิ่ม/ลด cart ซ้ำ
2. Map SKU ตาม shelf ก่อนสร้าง cart/case (Shelf 1 → Cola, Shelf 2 → Sprite Plus Tea)
3. ถ้า Basket A/B มี RSSI สดและต่างกันอย่างน้อย **10 dB** พร้อม active session ที่ตรงกัน ให้ FSM ประมวลผลโดยไม่เรียก Agent
4. กรณี **Single Active Basket** ระบบจัดเป็น `CLEAR` ได้เมื่ออ่านพบเพียงตะกร้าเดียว ตะกร้านั้นเป็นใบเดียวที่ active และ RSSI ถึงเกณฑ์ `SINGLE_BASKET_MIN_RSSI` (ค่าเริ่มต้น **−80 dBm**)
5. ถ้าทั้งสองตะกร้าต่างกันน้อยกว่า 10 dB ให้สร้าง ambiguous case และรอการยืนยันที่ผ่านกฎของ backend ก่อนเปลี่ยน cart
6. ถ้าหลักฐานไม่พอและไม่เข้าเงื่อนไข Single Active Basket, event เป็น delayed, ตะกร้าที่เป็น candidate ไม่มี active session หรือ `PUT_BACK` ขัดกับจำนวนที่ยืนยันแล้ว ให้ส่ง Staff review
7. `PUT_BACK` ต้องไม่ทำให้จำนวนติดลบ รายการ pending/conflict ไม่เข้ายอดจ่าย

เกณฑ์ส่วนต่าง **10 dB** ใช้เปรียบเทียบความแรงสัญญาณและต้องปรับเทียบกับตำแหน่งชั้นและ tag จริง การทดลอง [BLE fingerprinting](ble-location-setup.md) ใช้ข้อมูล RSSI เพื่อประมาณตำแหน่งแยกต่างหาก กฎ cart ใช้หลักฐานความใกล้ของตะกร้าและ session เท่านั้น

### เส้นทาง Local เทียบกับ Cloud ที่ deploy

| เส้นทาง | ปัจจุบัน |
| --- | --- |
| Local API + simulator/MQTT broker + local Laya + local JSON | ใช้พัฒนาและทดสอบ end-to-end ในเครื่อง; ports โดยทั่วไปคือ API `3000`, MQTT `1883`, Laya `8000`, YOLO `8001`, Web `3001` |
| Cloud Admin simulator → API Gateway HTTP → API Lambda | เปิดใช้กับ Staff ที่ยืนยัน Cognito; event ถูกระบุ source เป็น `SIMULATOR` |
| ESP32 → AWS IoT Core → Topic Rule → Ingest Lambda | `EnableIoT=true` และ provision 3 Shelf ตามบันทึก Cloud ส่วนผล physical E2E ครบทุกบอร์ดยังรอหลักฐาน |
| ESP32 → local MQTT bridge → local API | local integration path; application ACK หลัง API รับ event สำเร็จ |

## 4. Agentic Case Manager และ Step Functions

Admin Agent ใช้เครื่องมืออ่านหลักฐานสำหรับเคสกำกวมและเสนอขั้นตอนถัดไป การเปลี่ยน cart อยู่ภายใต้กฎของ backend และการตัดสินใจของคนในเคสที่ต้องตรวจสอบ

```mermaid
flowchart TD
  Case[Case created โดย FSM] --> SF[Step Functions Standard]
  SF --> Investigate[InvestigateFunction Lambda]
  Investigate -->|Ambiguous case| Runtime[Private AgentRuntime Lambda container]
  Investigate -->|Other unresolved case / error| Staff[Staff HITL]
  Runtime --> Bedrock[Bedrock Converse: เลือก action ที่อนุญาต 1 อย่าง]
  Bedrock --> Choice{action ที่เลือก}
  Choice -->|evidence tool| ToolLambda[ToolsFunction Lambda / read-only]
  Choice -->|inspect vision| YOLO[YOLO11n ใน Agent runtime]
  Choice -->|วิเคราะห์ตาม script| Script[Allowlisted evidence analysis]
  ToolLambda --> Observation[ผล evidence / observation]
  YOLO --> Observation
  Script --> Observation
  Observation --> Runtime
  Runtime -->|อ่านครบพอ| Laya[Laya: basket-choice probability]
  Laya --> Policy[Deterministic policy + conflict/session guards]
  Policy --> Route{nextAction}
  Bedrock -->|STOP_STAFF / timeout / invalid| Staff[Staff HITL]
  Route -->|candidate + confidence ผ่าน guard| Customer[Customer YES / NO]
  Route -->|confidence ต่ำ / evidence หาย / conflict| Staff
  Customer -->|YES / NO| Decide[API Lambda ตรวจสิทธิ์และกฎ cart]
  Customer -->|Timeout| Staff
  Staff -->|Approve / Reject| Decide
  Decide -->|Accepted YES / Approve| Cart[บันทึก decision + cart update]
  Decide -->|Accepted Reject| Reject[บันทึก decision + ปิดเคส]
  Decide -->|Customer NO / cart conflict| Staff
  Cart --> Callback[Step Functions task callback]
  Reject --> Callback
  Callback --> Validate[ValidateFunction ตรวจ resolution ที่บันทึกแล้ว]
  Validate --> Done[Done + workflow audit]
```

### ลำดับใน investigation

1. Ingest/API สร้าง event/case และบันทึก state; ถ้าเป็น unresolved case จะเริ่ม execution โดยใช้ชื่อ execution ที่ idempotent
2. Step Functions เรียก `InvestigateFunction` สำหรับ unresolved case โดยเรียก AgentRuntime เมื่อเป็น ambiguous case ส่วนเคสที่ต้องให้ Staff ตรวจจะเข้าสู่ Staff handoff ได้เลย
3. AgentRuntime ใช้ **Amazon Bedrock Converse** เลือก tool/action จาก enum ที่ส่งเข้าไปในรอบนั้นเท่านั้น แล้วรัน action และอ่าน observation ก่อนเลือกครั้งต่อไป
4. Tools ใช้อ่าน evidence ที่ผูกกับ case/event ปัจจุบัน: shelf event, basket RSSI/session, cart history, telemetry window, device health, lane state, nearby events และ camera records
5. `run_evidence_analysis` เลือกเฉพาะ script ที่ allowlist เช่น `rssi_stability`, `switch_bounce`, `cart_consistency`; ไม่มี shell, SQL หรือ path ที่ model สร้างเอง
6. `inspect_vision_evidence` เรียก YOLO11n เฉพาะภาพที่ register ไว้; class/box confidence เป็นหลักฐานประกอบ ไม่ได้แปลว่าพิสูจน์ SKU, PICK/PUT_BACK หรือ ownership
7. Laya เป็น typed decision adapter ที่คืน candidate/confidence; Bedrock เป็น action selector และไม่มี calibrated ownership confidence ของตัวเอง
8. Policy บังคับ candidate/session/RSSI/quantity/conflict guards และ confidence ขั้นต่ำ **0.75** ก่อนถามลูกค้า ถ้าไม่ผ่าน ให้ Staff ตัดสิน
9. API ตรวจสิทธิ์และตรวจว่า workflow กำลังรอการตัดสินใจจาก actor นั้น แล้วเรียกกฎของ domain เพื่อบันทึก human decision การยืนยัน YES หรือ Approve ที่ผ่านกฎจะอัปเดต cart ใน transaction เดียวกับ decision receipt ส่วน Reject ปิดเคสโดยคง cart เดิม จากนั้น API ส่ง `SendTaskSuccess` ให้ Step Functions และเมื่อถึง `ValidateFunction` จะตรวจว่าเคสปิดพร้อม resolution แล้วก่อนบันทึก workflow audit

การตัดสินใจไม่ส่ง chain-of-thought ให้ UI; Admin เห็น action ที่ model เลือก, probability ของการเลือก, tools ที่มี, observation และเหตุผลที่บันทึกได้เท่านั้น สำหรับ local agentic loop เอกสารกำหนดสูงสุด 8 action และ deadline 25 วินาที; Cloud Agent Lambda มี timeout สูงสุด 300 วินาทีตาม stack แต่ต้องวัด cold-start/latency และ full case workflow บน AWS ก่อนรับรอง

### State Machine ของ Step Functions

```mermaid
stateDiagram-v2
  [*] --> Investigate
  Investigate --> Route
  Investigate --> StaffApproval: Investigation error
  Route --> CustomerConfirmation: CUSTOMER_CONFIRM
  Route --> StaffApproval: Other action
  CustomerConfirmation --> AfterCustomer: Callback
  CustomerConfirmation --> StaffApproval: Timeout or task error
  AfterCustomer --> Validate: CLOSE
  AfterCustomer --> StaffApproval: NO or cart conflict
  StaffApproval --> Validate: Staff decision callback
  Validate --> Done: Recorded closed case and resolution
  Done --> [*]
```

Customer confirmation รอได้ 120 วินาที ส่วน Staff handoff รอได้สูงสุด 24 ชั่วโมง Reconciler ตรวจ workflow และ callback ที่ค้างทุกนาที ถ้า `ValidateFunction` หาเคสปิดพร้อม resolution ไม่พบ จะคืน error ให้ workflow การอัปเดต cart ต้องผ่านการยืนยันและกฎของ backend

## 5. Shopper, Staff และ realtime flow

```mermaid
sequenceDiagram
  participant C as Customer phone
  participant W as Shopper PWA
  participant BFF as HTTPS BFF
  participant API as API Gateway HTTP + API Lambda
  participant DB as DynamoDB
  participant WS as API Gateway WebSocket
  C->>W: สแกน QR Basket A/B
  W->>BFF: สร้าง session + pairing proof
  BFF->>API: POST /api/sessions
  API->>DB: ตรวจ owner/session แล้วบันทึก session
  API-->>BFF: session + basket token
  BFF-->>W: session + Set-Cookie (HttpOnly)
  Note over DB: เมื่อ backend บันทึกการเปลี่ยน state
  DB-->>WS: DynamoDB Stream → ChangesFunction
  WS-->>W: STATE_CHANGED (invalidation เท่านั้น)
  W->>BFF: GET authorized snapshot
  BFF->>API: ส่ง token สำหรับ scope ที่ถูกต้อง
  API->>DB: อ่านข้อมูล basket ที่ caller มีสิทธิ์
  API-->>BFF: cart, status, case prompts
  BFF-->>W: authorized snapshot
  W-->>C: แสดง confirmed total และคำถามยืนยัน
  C->>W: YES / NO / checkout แบบ mock
```

WebSocket ส่งเพียงข้อความ invalidation ไม่ส่ง cart ทั้งก้อน; browser ดึง authorized snapshot ผ่าน API อีกครั้ง ข้อมูล A/B, audit และ Agent evidence ถูก scope ตามสิทธิ์ ผู้ใช้ไม่มี AWS credentials ใน browser

### Shopper Agent

หน้า Shopper ส่งคำถามผ่าน HTTPS BFF ไปที่ `POST /api/shopper/query` บน API Lambda ซึ่งเรียก **Bedrock Converse (Nova Lite)** โดยตรง คำถามที่ต้องใช้ข้อมูลปกติเรียกโมเดลรอบแรกเพื่อเลือกเครื่องมืออ่านข้อมูล และรอบที่สองเพื่อเรียบเรียงคำตอบพร้อมแหล่งอ้างอิง

- คำถามเกี่ยวกับวิธีใช้ร้านค้น section ที่เกี่ยวข้องจากคู่มือร้านด้วยคีย์เวิร์ดภาษาไทยหรืออังกฤษ ส่วนข้อมูลสินค้าและตะกร้ามาจากเครื่องมือ backend
- Backend จำกัดการอ่านตะกร้าตาม basket/session ของผู้ถาม และตรวจผลกับแหล่งอ้างอิงจากเครื่องมือ แชตไม่มี action เปลี่ยนตะกร้า จ่ายเงิน หรืออนุมัติเคส
- Local development ใช้ Qwen ผ่าน OpenAI-compatible endpoint ตาม [คู่มือ Shopper Agent](shopper-agent.md) ส่วน AWS มี adapter สำหรับ Bedrock

### การยืนยันตัวตนและสิทธิ์

- Staff เข้าหน้า FAST `/admin/login` แล้ว BFF เริ่ม Cognito Authorization Code + PKCE; Cognito group `STAFF` เป็นสิทธิ์เข้าถึง dashboard/admin APIs
- BFF เก็บ access token ใน `HttpOnly`, `Secure` cookie และ backend ตรวจ issuer/client/token use/group อีกชั้น
- Shopper เริ่ม session ผ่าน QR pairing และได้รับ token ที่ผูก basket/session; shopper อ่านหรือ checkout ได้เฉพาะ basket ที่เป็นเจ้าของ
- WebSocket ใช้ single-use ticket อายุสั้นใน handshake; task token ของ Step Functions ไม่ส่งไป browser

## 6. Admin: Object Detection และ Stat Query

### Video, camera, map และ heatmap

```mermaid
flowchart LR
  Recorded[Recorded clip IMG_0465.MOV] --> YOLO[YOLO11n person detector]
  YOLO --> Track[ByteTrack ID / temporal samples]
  Track --> Overlay[กรอบ Customer บนคลิป]
  Track --> Map[Calibrated floor map + point trail]
  Track --> Heat[Heatmap ตาม media time]
  Webcam[กล้องบนเครื่องที่เปิด Admin] --> Browser[Browser permission + JPEG samples]
  Browser --> BFF[Same-origin staff BFF]
  BFF --> Agent[Private AgentRuntime Lambda]
  Agent --> LiveYOLO[YOLO11n + ByteTrack]
  LiveYOLO --> LiveView[Annotated canvas + map/heatmap]
```

- Recorded mode ใช้ clip ที่ให้มา; class `person` แสดงเป็น `Customer`, ใช้ ByteTrack และ map/heatmap sync กับ media time
- Basket A/B ที่กำหนดให้ track เป็น manual assignment จากเจ้าของ requirement ไม่ใช่การรู้จำใบหน้าหรือการคำนวณจาก BLE
- Live mode เปิดกล้องของเครื่องที่เปิด Admin ผ่าน browser permission/HTTPS แล้วส่ง JPEG ที่ลดขนาดผ่าน BFF ไป YOLO; ปัจจุบันไม่ใช่ RTSP integration
- Calibrate ด้วย 4 จุดของพื้นและจุดกึ่งกลาง footprint ของ Shelf 1–3; กล้องขยับ/เปลี่ยน zoom ต้อง calibrate ใหม่
- ภาพ live ไม่ถูกเก็บใน cart, database หรือ audit; detection เป็นข้อมูล visual analytics ไม่เปลี่ยน cart และไม่ตัดสินว่าใครหยิบสินค้า

### Stat Query Chat

```mermaid
flowchart LR
  Request[พนักงานถามยอดขาย / top products] --> Laya[Laya typed planner]
  Laya --> Plan{แผนใน allowlist}
  Plan --> Daily[query_daily_sales]
  Plan --> Top[query_top_products]
  Daily --> Aggregate[Backend aggregation + Bangkok dates]
  Top --> Aggregate
  Aggregate --> Data[Orders ใน DB หรือ Demo dataset ที่ติดป้าย]
  Aggregate --> UI[Bar / line / table visualization]
  Aggregate --> Audit[STAT_QUERY_COMPLETED audit]
```

Planner เลือก field เช่น query, metric, chart จาก typed choices; application ตรวจ plan, วัน/ช่วงเวลา, Top-N และความสอดคล้องกับข้อความก่อน aggregate ข้อมูล Orders ใช้ completed mock checkout เท่านั้น; pending cart/case ไม่รวม ไม่ส่ง row/customer/session ให้ Laya และไม่มี SQL/code ที่ model สร้างหรือเขียน DB

## 7. AWS architecture และหน้าที่ของแต่ละ service

```mermaid
flowchart TB
  subgraph Client[Client and entry]
    Browser[Shopper / Staff browser]
    Cognito[Amazon Cognito: STAFF identity]
    Web[Lambda Function URL: Next.js web]
    BFF[Same-origin BFF / PKCE cookies]
    Browser --> Web --> BFF
    Cognito --> BFF
  end
  subgraph API[API and workflows]
    Http[API Gateway HTTP API]
    ApiLambda[ApiFunction Lambda]
    Step[Step Functions Standard]
    Investigate[InvestigateFunction Lambda]
    Agent[Private AgentRuntime Lambda container]
    Bedrock[Amazon Bedrock Converse]
    Tools[ToolsFunction Lambda]
    Validate[ValidateFunction Lambda]
    Handoff[HandoffFunction Lambda]
    Http --> ApiLambda
    ApiLambda --> Step
    ApiLambda -->|Shopper Chat| Bedrock
    Step --> Investigate --> Agent
    Agent --> Bedrock
    Agent --> Tools
    Step --> Handoff
    Step --> Validate
  end
  subgraph State[State, realtime, evidence]
    DDB[(DynamoDB StateTable)]
    Control[(DynamoDB ControlTable)]
    Stream[DynamoDB Streams]
    WebSocket[API Gateway WebSocket]
    Changes[ChangesFunction Lambda]
    Archive[ArchiveFunction Lambda]
    S3[(S3 archive bucket)]
    DDB --> Stream --> Changes --> WebSocket --> Browser
    Stream --> Archive --> S3
    ApiLambda --> DDB
    Tools --> DDB
    Handoff --> Control
  end
  subgraph IoTPath[IoT enabled per deployment record]
    ESP[ESP32 X.509]
    IoT[AWS IoT Core MQTT]
    Rule[IoT Topic Rule]
    Ingest[IngestFunction Lambda]
    ESP -->|Events and telemetry| IoT
    IoT --> Rule --> Ingest
  end
  BFF --> Http
  Ingest -->|Event or telemetry records| DDB
  Ingest -->|Unresolved shelf event| Step
  Ingest -->|Event ACK| IoT
  IoT -->|ACK topic| ESP
```

### AWS service inventory

| Service / resource | ใช้ทำอะไร | สถานะตาม deployment record ล่าสุด |
| --- | --- | --- |
| AWS Lambda Function URL | HTTPS entry สำหรับ Next.js container (Shopper/Admin) | Deployed; Web Lambda Active |
| Amazon ECR | เก็บ Web/Agent container image; scan on push และ immutable tags | Deployed |
| Amazon Cognito User Pool/Client/STAFF | Staff login, OAuth code flow + PKCE identity | Deployed; demo staff user provisioned |
| API Gateway HTTP API | HTTP endpoint จาก BFF ไป API Lambda | Deployed |
| AWS Lambda `ApiFunction` | HTTP routes, auth, sessions/cart, simulator, case decisions, Shopper Agent และ query orchestration | Deployed |
| API Gateway WebSocket API | Realtime connection สำหรับ state invalidation | Deployed |
| AWS Lambda `WebSocketFunction` | ตรวจ single-use ticket บน connect และลบ connection ตอน disconnect | Deployed |
| DynamoDB `StateTable` | Encrypted business records: sessions, carts, events, cases, orders, telemetry, receipts, audit/meta; stream + PITR | Deployed |
| DynamoDB `ControlTable` | WebSocket tickets/connections, HITL task tokens/decisions, TTL cleanup | Deployed |
| AWS Secrets Manager | Session signing / QR pairing secret; ไม่ส่ง secret ให้ browser | Deployed |
| AWS Step Functions Standard | Orchestrate investigation, customer/staff wait, validation และ close | Deployed; full AWS case acceptance ยังรอ |
| AWS Lambda `InvestigateFunction` | Step Functions entry ไป private Agent runtime | Deployed |
| AWS Lambda `AgentRuntime` container | Private Node runtime, Laya, YOLO และ Bedrock tool-selection loop | Deployed; health/readiness ผ่าน, full case E2E รอ |
| Amazon Bedrock Converse | Admin Agent ใช้เลือก action/tool ส่วน Shopper Agent ใช้เลือกเครื่องมือและเขียนคำตอบจากหลักฐาน | Invoke readiness ผ่านด้วย `apac.amazon.nova-lite-v1:0`; full Cloud acceptance ยังรอ |
| AWS Lambda `ToolsFunction` | เรียก read-only case evidence tools แบบจำกัด ARN/arguments | Deployed |
| AWS Lambda `HandoffFunction` | บันทึก/ส่ง customer หรือ staff task-token callback | Deployed |
| AWS Lambda `ValidateFunction` | ตรวจเคสที่ปิดแล้วและ human resolution ที่ API บันทึกไว้ จากนั้นบันทึก workflow audit | Deployed |
| AWS Lambda `ReconcileFunction` | ทำงานทุกนาทีเพื่อตรวจ workflow/callback ที่ยังไม่ launch/resume | Deployed |
| AWS Lambda `IngestFunction` + IoT Topic Rule | บน `main` ใช้ Rule เดียวรับทั้งสอง topic โดย event ผ่าน FSM และได้ ACK ส่วน telemetry บันทึกสถานะ device | Deployed ตามบันทึก Cloud โดย `EnableIoT=true` และ provision 3 Shelf ส่วน per-board E2E ยังรอหลักฐาน |
| AWS Lambda `ChangesFunction` | อ่าน DDB stream changes แล้วส่ง realtime invalidation | Deployed; transient WS error handling ปรับแล้ว |
| AWS Lambda `ArchiveFunction` + S3 | Archive event/case/order/audit record จาก stream; S3 private, SSE-S3, versioned, 90-day lifecycle | Deployed |
| Amazon CloudWatch Logs | Application/Lambda logs; retention 14 วัน | Deployed |
| CloudWatch alarms + SQS FailureQueue + SNS | แจ้งเมื่อ Lambda error หรือ FailureQueue มีข้อความ | Deployed; current alarm/queue depth ไม่ได้ตรวจใน snapshot 17 พ.ย. |
| AWS CloudTrail | Management API activity trail และ log file validation | Deployed |
| AWS Budgets | Email alert เมื่อค่าใช้จ่ายจริงเกิน 80% ของงบรายเดือน US$50 | Deployed; เป็น alert ไม่ใช่ hard spending cap |

AWS Lambda Web Adapter ทำหน้าที่เป็น adapter ให้ Next.js/Agent container รับ Lambda invocation; ไม่ใช่ AWS application service แยกต่างหาก ส่วน YOLO และ Laya เป็น model/runtime ที่อยู่ใน Agent container ไม่ใช่ managed AWS AI endpoint

### Data, realtime และ audit

```mermaid
flowchart LR
  Event[Event / telemetry / API decision] --> Lambda[API / Ingest / Validator Lambda]
  Lambda --> State[(DynamoDB StateTable)]
  State --> Stream[DynamoDB Streams]
  Stream --> Realtime[ChangesFunction]
  Realtime --> WS[WebSocket state invalidation]
  WS --> Browser[Client refetch authorized snapshot]
  Stream --> Archive[ArchiveFunction]
  Archive --> S3[S3 business archive]
  Lambda --> Audit[Case timeline + audit records in DynamoDB]
  Lambda --> Logs[CloudWatch Logs]
  Logs --> Alarm[CloudWatch Lambda error alarms]
  Failures[SQS FailureQueue] --> QueueAlarm[CloudWatch queue alarm]
  QueueAlarm --> SNS[SNS email notification]
  Ops[AWS management activity] --> Trail[CloudTrail] --> S3
```

Business audit เก็บ case timeline และ action เช่น event, evidence/tool result, model proposal, customer/staff decision, validation และ cart/order update ใน state records; CloudWatch ใช้ application logs/alarms; CloudTrail เก็บ AWS management activity; S3 เป็น archive แยกจาก live state

บน `main` ระบบเก็บ telemetry ล่าสุดสูงสุด 120 ตัวอย่างรวมทุก Shelf ใน state โดยใช้ตัวอย่าง `DEVICE` ล่าสุดของแต่ละ Shelf แสดงสถานะ `UNKNOWN` ก่อนมีตัวอย่างแรก, `ONLINE` เมื่ออายุไม่เกิน 5 วินาที และ `OFFLINE` เมื่อเกิน 5 วินาที สถานะและ RSSI จาก heartbeat ใช้ดูสภาพปัจจุบัน ส่วน RSSI ของ event ใช้เป็นหลักฐานของธุรกรรมนั้น

## 8. ตัวอย่าง business flows

| Scenario | เส้นทาง | ผลกับ cart |
| --- | --- | --- |
| Clear PICK / Basket A เด่นกว่าอย่างน้อย 10 dB หรือผ่าน Single Active Basket | Event → validation/dedupe → SKU mapping → deterministic FSM | เพิ่มรายการยืนยันโดยไม่เรียก Admin Agent |
| Ambiguous PICK | Event → case → Step Functions → Bedrock เลือก evidence tools → Laya/policy → Customer YES/NO | ระหว่างรอไม่เพิ่มยอด การตอบ YES ที่ผ่านกฎ backend จึงเพิ่มรายการ ส่วน NO หรือ timeout ส่งให้ Staff |
| Low confidence / หลักฐานไม่พอ / event delayed / conflict | FSM หรือ Agent ส่งให้ Staff → API ตรวจ Approve/Reject → callback → ตรวจ resolution | Approve ที่ผ่านกฎอัปเดต cart ส่วน Reject คง cart เดิม |
| PUT_BACK | Event → same mapping and guards; ตรวจว่ามี quantity confirmed | ลบได้เฉพาะจำนวนที่มี; ป้องกัน quantity ติดลบ; conflict ไป Staff |
| Duplicate delivery / sensor bounce | Event ID idempotency และ firmware debounce | ไม่เพิ่ม/ลดซ้ำ; duplicate ถูก audit แล้ว ignore |
| Object detection | Recorded replay หรือ live camera → YOLO/ByteTrack → overlay/map/heatmap | เป็น analytics; ไม่ mutate cart |
| Stat Query | พนักงานถาม → Laya typed plan → allowlisted backend aggregate → graph/table + audit | อ่านข้อมูลเท่านั้น; ไม่เปลี่ยน cart/order |
| Shopper Chat | Shopper → API Lambda → Bedrock เลือกเครื่องมือ → อ่านข้อมูลหรือค้นคู่มือ → คำตอบพร้อมแหล่งอ้างอิง | อ่านข้อมูลในขอบเขต session |

## 9. สถานะ deployment, ข้อจำกัด และงานคงเหลือ

### Historical Cloud snapshot — 25 ต.ค. 2026

- CloudFormation stack `fast-prototype` เป็น `UPDATE_COMPLETE`; Web/Agent Lambda เป็น `Active` / `Successful`
- Web Function URL, API Gateway HTTP/WebSocket, Cognito, DynamoDB, Step Functions และ S3 archive สร้างแล้ว
- Bedrock readiness เรียกจริงผ่าน Converse ด้วย model `apac.amazon.nova-lite-v1:0`; นี่เป็น readiness/tool-selection check ไม่ใช่ผลพิสูจน์ full Agent investigation
- Admin/Shopper เคยเข้าสู่ระบบ/โหลด state ได้ผ่าน deployed app
- IoT ปิดในการ deploy รอบแรก จากนั้นเปิดใน stack update ตามบันทึก Cloud ที่อ้างการตรวจ CloudFormation วันที่ 25 ต.ค. ด้วย `EnableIoT=true` และ IoT Thing 3 ตัว
- Camera mode ใช้กล้องของเครื่องที่เปิด Admin ผ่าน browser/HTTPS; RTSP capture ยังไม่ implement
- Recorded customer map/heatmap ใช้ YOLO11n + ByteTrack และ calibration จากคลิปที่มี; map ไม่ยืนยัน identity/ownership
- Checkout เป็น mock payment; ไม่มี POS/ERP, real payment, membership/coupon หรือ multi-store
- Cloud full case path (Agent + Step Functions callbacks + validator), Shopper QR, camera inference, latency/cost และ physical acceptance ยังต้องทดสอบบน AWS ก่อนเรียกว่า production-ready

### Alarm/backlog snapshot เก่า (ไม่ใช่ current queue count)

ข้อมูลด้านล่างมาจาก CloudWatch read ครั้งก่อนการ reset/deploy รอบใหม่ จึงไม่ใช่สถานะปัจจุบันและห้ามใช้อ้างจำนวนข้อความค้างวันนี้:

- `ChangesFunction` transient WebSocket/DNS failures ได้แก้แล้ว; Lambda error alarm เป็น OK และ stream mapping เป็น OK
- ย้ายเฉพาะ failure messages ของ `ChangesFunction` 31 รายการไป S3 archive และลบจาก FailureQueue ตาม approval
- FailureQueue เคยเหลือ **1,405 historical IngestFunction messages**; ตัวเลขนี้เป็นข้อมูลใน snapshot เดิมเท่านั้น ไม่ได้ตรวจคิวซ้ำใน deployment วันที่ 17 พ.ย.

### ขอบเขตความเชื่อมั่น

| ระบบ | ทำได้ | ยังไม่ควรอ้างว่า |
| --- | --- | --- |
| BLE RSSI | ใกล้กว่า/สัญญาณในโซน | พิสูจน์ตัวคนหรือยืนยันผู้หยิบ |
| YOLO11n COCO | ตรวจ `person`/กรอบ object ตาม class ที่โมเดลรู้จัก | ตรวจ SKU/ทิศทาง pick-return/ownership โดยไม่มี detector และหลักฐานที่ calibrate |
| Bedrock | เลือกจาก tool/action ที่อนุญาต | มี confidence ownership ที่ calibrate หรือแก้ cart โดยตรง |
| Laya | คืน typed candidate/probability ตาม contract | ความแม่น retail ที่รับรองแล้ว |
| Local E2E | ทดสอบ MQTT/bridge/FSM/Agent/HITL/cart/audit ผ่าน software harness | ยืนยัน AWS IoT/Cloud callbacks/physical hardware ทุก shelf |
| Cloud deploy | ยืนยัน resources และ readiness บางเส้นทาง | ระบบผ่าน full production acceptance |

## 10. แผนภาพย่อสำหรับการนำเสนอ

```mermaid
flowchart LR
  Pick[Switch detect PICK/PUT_BACK] --> RSSI[ESP32 attach filtered BLE RSSI]
  RSSI --> Event[MQTT event + eventId]
  Event --> FSM{Deterministic FSM}
  FSM -->|clear + active session| Cart[Confirmed cart]
  FSM -->|ambiguous| Agent[Bedrock selects evidence; Laya scores]
  FSM -->|missing/conflict| Staff[Staff review]
  Agent -->|eligible| Customer[Customer confirms]
  Agent -->|low/conflict/error| Staff
  Customer --> Decision[Decision API / domain rules]
  Staff --> Decision
  Decision -->|Accepted YES or Approve| Cart
  Decision -->|Closed case callback| Workflow[Step Functions checks recorded resolution]
  Cart --> Live[WebSocket invalidation + API snapshot]
  Live --> Shopper[Shopper PWA]
  Live --> Admin[Staff Admin]
```

> **กฎสรุป:** Shelf ส่งหลักฐานให้ FSM ตรวจ เมื่อเกิดเคสกำกวม Agent ช่วยตรวจหลักฐานและ backend อัปเดต cart หลังได้รับคำยืนยันที่ผ่านกฎของระบบ

## 11. เอกสารอ้างอิงภายใน

- [Project README](../README.md) - local stack, scope, commands และ system map
- [Cloud deployment kit](../infra/cloud/README.md) - deploy parameters, AWS components, security/recovery boundaries
- [Cloud deployment status](cloud-deployment-status.md) - บัญชี/Region, services ที่ deployed และ acceptance คงเหลือ
- [Agentic investigation](agentic-investigation.md) - tool catalog, decision loop และ local verification boundary
- [Shopper Agent](shopper-agent.md) - คู่มือร้าน เครื่องมืออ่านข้อมูล และ Bedrock adapter
- [BLE positioning experiment](ble-location-setup.md) - การทดลองอ่าน RSSI จากหลาย Shelf และข้อจำกัดในการวัดตำแหน่ง
- [Event contract](event-contract.md) - event schema, decision rules, ACK และ telemetry
- [IoT roadmap](iot-roadmap.md) - hardware wiring, BLE/beacon, firmware/outbox และ acceptance tests
- [Shelf product mapping](shelf-product-mapping.md) - product mapping ตาม shelf ปัจจุบัน
- [Customer detection](customer-detection.md) และ [Admin camera controls](admin-controls-camera.md) - recorded/live video, map calibration และ limits
- [Stat Query](stat-query.md) - typed planner, allowlisted aggregates และ chart behavior
- [FAST tech answers](2026-10-25-FAST_FINAL_Questions_for_Tech_Hardware_Answers.md) - ขอบเขตระบบ/IoT ที่ตรวจล่าสุด
