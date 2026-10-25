# Replicate FAST: Cloud, Local และ Hardware

คู่มือนี้ใช้ clone public repository แล้วทำ FAST demo ขึ้นใหม่ในเครื่องหรือ AWS account ของผู้ทำซ้ำ อัปเดตจาก scripts และ firmware ใน repository วันที่ 25 ตุลาคม 2026

> การสร้าง AWS stack มีค่าใช้จ่ายจริง และ budget ใน stack เป็นการแจ้งเตือน ไม่ใช่การหยุดค่าใช้จ่ายอัตโนมัติ อย่า deploy ใน account ที่ไม่ได้รับอนุญาต

## 1. Clone repository

ต้องมี Git, Node.js 24 LTS (ขั้นต่ำตาม package คือ Node.js 20), Python 3.12 และ PowerShell บน Windows

```powershell
git clone https://github.com/thhanabun/NTT_Prototype.git
Set-Location .\NTT_Prototype
git switch main
```

อย่า clone `.worktrees` หรือคัดลอก `data/` จากเครื่องอื่น โฟลเดอร์เหล่านี้มี state, outputs และ credential ที่ไม่ควรแชร์

## 2. Run Local software

ติดตั้ง Node dependencies ครั้งแรก:

```powershell
npm ci
npm --prefix web ci
```

เริ่มระบบทั้งหมดเป็น background services:

```powershell
.\scripts\start-local.ps1 -Install
```

เริ่มครั้งถัดไปโดยไม่ติดตั้งใหม่:

```powershell
.\scripts\start-local.ps1
```

Launcher เริ่ม Laya, YOLO, API, MQTT broker และ Next.js Web พร้อมค่า local ที่จำเป็นให้แล้ว ใช้ `-Install` เฉพาะ setup ครั้งแรกหรือเมื่อต้องติดตั้ง dependencies ใหม่ หากต้องการเห็น log ในแต่ละหน้าต่าง ให้เปิด PowerShell แยกจาก repository root แล้วใช้คำสั่งเหล่านี้:

| Terminal | คำสั่ง | Port |
| --- | --- | ---: |
| 1 · Laya agent | `.\scripts\start-local.ps1 -Service laya` | 8000 |
| 2 · YOLO vision | `.\scripts\start-local.ps1 -Service vision` | 8001 |
| 3 · API/FSM/cart/audit | `.\scripts\start-local.ps1 -Service api` | 3000 |
| 4 · MQTT broker | `.\scripts\start-local.ps1 -Service broker` | 1883 |
| 5 · Shopper/Admin web | `.\scripts\start-local.ps1 -Service web` | 3001 |

Environment ที่ launcher ตั้งให้รวม `STORE_BACKEND=local`, `AGENT_PROVIDER=laya`, `AGENT_MODE=agentic`, `SINGLE_BASKET_MIN_RSSI=-80` และการ forward MQTT เข้า API ใช้ Basket session ใน Shopper แล้วเปิด Staff ที่ `http://localhost:3001/admin` หรือ Shopper ที่ `http://localhost:3001/shopper`

ถ้าพอร์ตถูกใช้อยู่ ให้ตรวจว่า service เดิมพร้อมใช้งานหรือไม่ก่อนเปิดซ้ำ ตัวอย่างตรวจ PID:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object LocalPort, OwningProcess
Get-Process -Id <PID>
```

Log ของ launcher อยู่ใน `tmp/local-services/`; local state อยู่ใน `data/` และไม่ถูกล้างเมื่อเริ่มระบบ

### ส่งสัญญาณจำลองผ่าน MQTT

หลัง API, broker, Laya และ Web พร้อม ให้เริ่ม Basket session ก่อน แล้วเปิด Terminal เพิ่มจาก repository root:

```powershell
npm run mock:evidence -- stable
```

คำสั่งนี้ส่ง telemetry และ PICK จำลองไป MQTT; รอข้อความ `Application ACK received` แล้วตรวจ case/cart บนหน้า Shopper และ Staff คำสั่งไม่ใช่การทดสอบ ESP จริง

## 3. ต่อ ESP32 กับ Local

### อุปกรณ์และการต่อสาย

- ESP32-WROOM DevKit, KW11-N/KW12 roller microswitch และ iBeacon BLE tags สำหรับ Basket A/B; tag HV01 เป็นหลักฐานอ้างอิงทางเลือก
- Product mapping ใน source ปัจจุบัน: event จาก Shelf 1 ถูก map เป็น Cola และ Shelf 2 เป็น Sprite Plus Tea; หน้า Shopper แสดง Shelf 3 เป็น Fanta floral bloom แต่ SKU ที่หน้าเว็บกำหนดไว้ยังเป็น `COKE` และ backend ใช้ SKU ที่มากับ lane event
- ปิดไฟ USB ก่อนต่อสายสวิตช์: `COM` ไป `GND`, `NO` ไป GPIO และไม่ใช้ `NC`
- Shelf 1/2 ใช้ GPIO 26 สำหรับ LANE-1 และ GPIO 27 สำหรับ LANE-2 (`INPUT_PULLUP`); ปิดสวิตช์หมายถึง `LOW`/มีสินค้า, เปิดวงจรหมายถึง `HIGH`/สินค้าถูกหยิบ
- Shelf 3 sketch กำหนด GPIO 4/5 และเอกสารบอร์ดระบุ ESP32-S3; ตรวจรุ่นบอร์ดและ pinout ก่อนใช้ sketch นี้
- BLE ต้องประกาศ iBeacon และต้องตั้ง MAC/UUID/major/minor ให้ตรงกับค่าที่ firmware ใช้ ตรวจ MAC ด้วย `firmware/esp32/ble_test` แล้วแก้ใน `secrets.h`; firmware ใช้ median สูงสุด 5 ตัวอย่างในหน้าต่าง 5 วินาทีและเริ่มจาก clear lead 10 dB ค่า RSSI `-80` ของ local API เป็นอีกเกณฑ์หนึ่ง ควร calibrate บนชั้นจริง RSSI เป็นหลักฐานความใกล้ ไม่ใช่การยืนยันตัวผู้หยิบ

### ตั้งค่าเครื่องและ firmware

ติดตั้ง Arduino CLI, ESP32 Arduino core และ libraries รุ่นที่ hardware integration ตรวจผ่าน:

```powershell
arduino-cli core update-index
arduino-cli core install esp32:esp32@3.3.12
arduino-cli lib update-index
arduino-cli lib install NimBLE-Arduino@2.5.1 PubSubClient@2.8.0
arduino-cli board list
```

สร้างไฟล์ local secrets จากตัวอย่าง แล้วแก้ค่า Wi-Fi และ IP ของคอมพิวเตอร์ที่รัน broker:

```powershell
Copy-Item firmware/esp32/secrets.example.h firmware/esp32/secrets.h
notepad firmware/esp32/secrets.h
```

ตั้ง `WIFI_SSID`, `WIFI_PASSWORD` และ `LOCAL_MQTT_HOST` เป็น IPv4 ของคอมพิวเตอร์ใน LAN เดียวกับ ESP32 (ดูจาก `ipconfig`) ห้ามใช้ `127.0.0.1` เป็น MQTT host ใน firmware เพราะ loopback ของ ESP32 ไม่ใช่คอมพิวเตอร์ หากใช้ HTTP fallback ให้ตั้ง `LOCAL_SERVER_HOST` เป็น IP เดียวกันด้วย ไฟล์ `secrets.h` ถูก ignore ใน Git

Windows Firewall ต้องอนุญาต TCP `1883` บน **Private network เท่านั้น** สำหรับการทดสอบจาก ESP32; broker local ไม่มี TLS/authentication จึงห้ามเปิดพอร์ตออก Internet

Compile, upload และเปิด serial monitor โดยแทน `COM8` ด้วยพอร์ตที่ `arduino-cli board list` แสดง:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/local-shelf-build firmware/esp32/local_shelf
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM8 --input-dir tmp/local-shelf-build firmware/esp32/local_shelf
arduino-cli monitor --port COM8 --config baudrate=115200
```

ถ้าจะตรวจสายก่อน ใช้ `firmware/esp32/limit_switch_test`; ใช้ `firmware/esp32/ble_test` ตรวจ tag และ MAC ก่อนเปิด firmware หลัก ดู pinout และ test guide เพิ่มเติมที่ [firmware README](../firmware/esp32/README.md) และ [IoT roadmap](iot-roadmap.md)

### ตรวจ local hardware flow

1. คอมพิวเตอร์และ ESP32 อยู่ Wi-Fi/LAN เดียวกัน; firmware แสดง Wi-Fi connected และ MQTT connected
2. เปิด Shopper/Staff ค้างไว้ จากนั้นหยิบและวางคืนสินค้าทีละ lane
3. ตรวจ event, shelf, lane, RSSI, cart/case และ application ACK; การ publish MQTT อย่างเดียวไม่ยืนยันว่า API รับ event แล้ว
4. ทดลอง duplicate/retry, ปิด BLE tag และนำ Basket A/B เข้าใกล้กัน รายการที่ยังไม่ยืนยันต้องไม่เข้ายอด payable

## 4. Replicate Cloud ใน AWS account ของผู้ทำซ้ำ

Cloud stack ต้อง deploy แยกใน account ที่มีสิทธิ์และ billing owner อนุมัติ ไม่มี AWS access key, certificate หรือ private key แจกผ่าน GitHub

### เครื่องมือและ identity

ติดตั้ง [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) พร้อม Linux engine, Node.js และ Python 3.12 ใช้ IAM Identity Center/SSO หรือ deployment role ที่องค์กรอนุมัติ ห้ามใส่ access key ลง source, command history หรือ `data/cloud-config.json` สคริปต์ deploy ใช้ `aws`, `sam`, `docker` และ `node` ที่เรียกได้จาก PATH

สร้าง Python environment สำหรับ scripts ที่สร้าง Cognito user/warm Agent:

```powershell
python -m venv .venv-cloud
.\.venv-cloud\Scripts\python.exe -m pip install boto3
```

```powershell
aws sso login --profile <YOUR_PROFILE>
aws sts get-caller-identity --profile <YOUR_PROFILE>
```

ตรวจว่า account/role ที่แสดงเป็น account ที่ตั้งใจ deploy จริง สคริปต์ preflight ตรวจ `iam:PassRole`; ถ้า role ถูกปฏิเสธให้ขอผู้ดูแล AWS อนุมัติ ห้ามข้าม preflight หรือสร้าง role นอกนโยบายองค์กร

### ตั้งค่าและ deploy

ติดตั้ง dependencies และสร้างไฟล์ config ในโฟลเดอร์ ignored `data/`:

```powershell
npm ci
npm --prefix web ci
New-Item -ItemType Directory -Force data | Out-Null
Copy-Item infra/cloud/config.example.json data/cloud-config.json
notepad data/cloud-config.json
```

กรอก account ID, region, profile, stack name, unique image tag, Bedrock model ID และ **exact** model/inference-profile ARNs ที่ role เรียกได้ รวมถึง budget email และวงเงินแจ้งเตือน ห้ามใส่ wildcard ใน `bedrockInvokeResources` ถ้าต้องการ IoT กับ hardware ให้ตั้ง `enableIoT` เป็น `true`; ถ้าทำเฉพาะ mock event ให้ใช้ `false`. ตรวจ model access ของ account/region ใหม่ เพราะชื่อ model ในไฟล์ config ไม่ได้เปิดสิทธิ์ให้ account นั้นโดยอัตโนมัติ

ตรวจ source/templates ก่อน deploy:

```powershell
npm run cloud:prepare
sam validate --lint --template-file infra/cloud/template.json
npm test
npm --prefix web run test:cloud
```

Deploy จะสร้างหรือแก้ AWS resources และ push container images ไป ECR:

```powershell
aws sso login --profile <YOUR_PROFILE>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-cloud.ps1 -ConfigPath data/cloud-config.json
```

เก็บ outputs ไว้ใน `data/cloud-outputs.json`; ใช้ตรวจ Web URL และ resource IDs หลัง deploy ไฟล์นี้ไม่ควร commit แม้ไม่เก็บ private key ก็ตาม Stack มี Lambda containers สำหรับ Web/Agent, API Gateway HTTP/WebSocket, Cognito, DynamoDB, Step Functions, Bedrock call, CloudWatch, CloudTrail, S3 archive และ budget/alarms ตาม template

หลัง deploy:

```powershell
node scripts/check-cloud-web.mjs
node scripts/cloud-pairing.mjs
.\.venv-cloud\Scripts\python.exe scripts/warm-cloud-agent.py
```

สร้าง Cognito `STAFF` user ด้วยขั้นตอนใน [Cloud deployment README](../infra/cloud/README.md); ให้เจ้าของบัญชีตั้งรหัสผ่านแบบ prompt ไม่ใส่รหัสผ่านใน Git/argument แล้วซ้อม simulator, HITL, cart, checkout แบบ mock และตรวจ logs/alarms ก่อนต่อ hardware

### เปิดใช้ IoT และ provision ESP32

Stack ที่ deploy ต้องมี `EnableIoT=true` ก่อน `provision-cloud-device.ps1` จึงจะทำงานได้ แต่ละ shelf ใช้ Thing/certificate ของตัวเอง ห้ามแชร์ private key ข้ามบอร์ดหรือ repository:

```powershell
.\scripts\provision-cloud-device.ps1 -ShelfId SHELF-01
```

ใช้ `SHELF-02` หรือ `SHELF-03` สำหรับบอร์ดนั้น สคริปต์เรียก AWS IoT เพื่อสร้าง/ผูก certificate และเขียน endpoint/CA/certificate/private key ลง `data/aws-device/` (ignored); firmware รวม credential header จาก path นี้ตอน compile

แก้ `firmware/esp32/secrets.h` ให้มี Wi-Fi SSID/password และ tag ของอุปกรณ์ จากนั้น compile/upload sketch ให้ตรง shelf:

| Shelf | Sketch path | Board/pin note |
| --- | --- | --- |
| `SHELF-01` | `firmware/esp32/aws_shelf` | ESP32-WROOM, GPIO 26/27 |
| `SHELF-02` | `firmware/esp32/aws_shelf_02` | ใช้ Thing/certificate ของ `SHELF-02` |
| `SHELF-03` | `firmware/esp32/aws_shelf_03` | GPIO 4/5; ตรวจ board/FQBN จริงก่อน flash |

ตัวอย่าง Shelf 1:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/aws-shelf-build firmware/esp32/aws_shelf
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM8 --input-dir tmp/aws-shelf-build firmware/esp32/aws_shelf
arduino-cli monitor --port COM8 --config baudrate=115200
```

เปลี่ยน sketch/build directory ตาม shelf และ board จริงก่อน compile/upload สำหรับ AWS firmware ใช้ MQTT over TLS ที่ port `8883`; device publish `smartbasket/shelf/<SHELF-ID>/events` และ `/telemetry`, แล้วรอ application ACK บน `/acks`. ตรวจ AWS IoT test client, Lambda logs, Admin device status และ cart/case; MQTT publish success เพียงอย่างเดียวไม่ใช่ end-to-end acceptance

## 5. สถานะ Cloud ที่ตรวจในบัญชี FAST

การตรวจ read-only วันที่ 25 ต.ค. 2026 พบ CloudFormation stack `fast-prototype` เป็น `UPDATE_COMPLETE`, `EnableIoT=true`, ใช้ Bedrock model ID `apac.amazon.nova-lite-v1:0` และมี IoT Thing 3 ตัว, policy 1 ตัว และ topic rule 1 ตัว สถานะ resource inventory ไม่แทนผลทดสอบ ESP จริง

เว็บปัจจุบันใช้ Lambda Function URL เป็น HTTPS entrypoint; การตรวจ read-only ไม่พบ Route 53 hosted zone, CloudFront distribution หรือ ACM certificate ใน `us-east-1`. Custom domain ยังแยกต่างหากและต้องมี domain ที่จดทะเบียน, CloudFront และ ACM certificate ใน `us-east-1` ก่อนเพิ่ม

## 6. Public repository และ secrets

- ห้าม commit `firmware/esp32/secrets.h`, `data/aws-device/**`, `data/cloud-config.json`, `data/cloud-outputs.json`, `.env`, certificate/private key, Wi-Fi password หรือ model credentials
- ตรวจ `git status --short` ก่อน commit และตรวจไฟล์ใหม่ทุกครั้ง เพราะ `git add .` อาจรวมไฟล์ที่ไม่ควรเผยแพร่
- ถ้า credential ถูก commit ไปแล้ว ให้ถือว่ารั่วและ revoke/rotate ในระบบต้นทาง การลบไฟล์ใน commit ใหม่ไม่ทำให้ credential เก่าปลอดภัย
- Local Admin mock login ใช้เพื่อทดสอบ UI เท่านั้น ไม่ใช่ authentication สำหรับ Cloud

## แหล่งอ้างอิงใน repository

- [Local setup](local-setup.md)
- [Cloud deployment kit และ permissions](../infra/cloud/README.md)
- [ESP32 pinout, build และ flash](../firmware/esp32/README.md)
- [MQTT bridge และ topics](../infra/aws-iot/README.md)
- [Signal/event contract](event-contract.md)
- [Cloud deployment status](cloud-deployment-status.md)

## Official tool references

- [Arduino-ESP32 installation](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html)
- [Arduino CLI core install/version syntax](https://arduino.github.io/arduino-cli/latest/commands/arduino-cli_core_install/)
- [NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino)
- [PubSubClient](https://github.com/knolleary/pubsubclient)
