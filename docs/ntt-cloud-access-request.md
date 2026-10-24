# FAST: สิทธิ์ AgentCore ของ NTT และทางเลือก runtime

**แนวทางปัจจุบัน:** ใช้ Lambda container สำหรับ Web และ Agent/Laya/YOLO ผ่าน AWS Lambda Web Adapter โดย Agent ไม่มี public URL และเรียกผ่าน IAM InvokeFunction; ยังคง Bedrock Converse และ ChallengerAccess เดิม ไม่ต้องเพิ่ม AgentCore permission สำหรับแนวทางนี้

## สิทธิ์สำหรับทางเลือก AgentCore

ขอให้ผู้ดูแล NTT เพิ่ม `iam:PassRole` สำหรับ `bedrock-agentcore.amazonaws.com` ให้ permission set **ChallengerAccess** ในบัญชี **NTT – Challenger Team 14 (`134250568427`)** แล้ว provision permission set ลงบัญชีนี้อีกครั้ง หรือให้ใช้ deployment role ที่ได้รับอนุมัติและมีสิทธิ์นี้อยู่แล้ว

ไฟล์ [policy ที่เสนอ](../infra/cloud/ntt-agentcore-passrole-request.json) จำกัดเฉพาะ execution role ของ FAST (`fast-prototype-AgentRole-*`) และเฉพาะบริการ AgentCore ไม่ได้ขอ AdministratorAccess และยังไม่ได้ apply policy นี้

ผู้ดูแลควรแก้ผ่าน IAM Identity Center permission set ไม่แก้ AWSReservedSSO role ที่ generate ลงบัญชีโดยตรง

## หลักฐานที่ตรวจได้จริง — 24 ต.ค. 2026

- Region ของระบบ: Singapore (`ap-southeast-1`)
- CLI profile: `ntt-fast`; ผ่าน NTT portal + MFA แล้ว
- STS account: `134250568427`
- SSO role: `AWSReservedSSO_ChallengerAccess_1298d10246cb5005`
- Attached policies: `PowerUserAccess`, `IAMReadOnlyAccess`
- Inline policy `AwsSSOInlinePolicy` อนุญาตสร้าง execution roles แต่รายการ `iam:PassedToService` ของ `iam:PassRole` ยังไม่มี AgentCore

ผลจาก `iam simulate-principal-policy` สำหรับ role ของ FAST:

| PassedToService | ผลจำลอง |
| --- | --- |
| `bedrock-agentcore.amazonaws.com` | `implicitDeny` |
| `apprunner.amazonaws.com` | `allowed` |
| `lambda.amazonaws.com` | `allowed` |

ผลจำลองเป็นการตรวจ identity policy ไม่ยืนยัน SCP, quota หรือเงื่อนไขบริการอื่นทั้งหมด ต้องตรวจ deployment จริงหลังสิทธิ์พร้อม

Bedrock Nova Lite มี authorization, entitlement และ region availability แล้ว จุดที่ติดคือการ pass execution role ให้ **AgentCore Runtime** ซึ่งเป็นคนละส่วนกับสิทธิ์เรียกโมเดล

## สถานะ deployment — 25 ต.ค. 2026

- ECR bootstrap และ Web/Agent images สำหรับ Lambda amd64 push สำเร็จ
- App Runner CreateService จริงไม่ผ่าน PassRole แม้ simulation ของ generic service context เป็น allowed จึงไม่ใช้แนวทางนั้น
- Lambda CreateFunction ผ่านจุดตรวจสิทธิ์แล้ว แต่ memory 8,192 MB เกิน quota บัญชี 3,008 MB จึงปรับ template ให้ตรง quota และ retry
- Failed stack rollback โดยเก็บ retained resources ไว้ ไม่ลบ DB/archive/secret; inventory อยู่ ignored `data/cloud-recovery-retained.json`
- ไม่มีการสร้าง IoT Thing/device policy/rule และไม่ได้เปลี่ยน firmware หรือข้อมูล local demo
- Lambda stack deploy สำเร็จ, Cognito login เข้า Admin ได้ และ Laya/YOLO health เป็น Healthy
- Bedrock Converse รอบแรกติด HTTP 403 account verification แต่ตรวจซ้ำวันที่ 25 ต.ค. เรียกจริงผ่านแล้ว: Nova Lite เลือก `STOP_STAFF` สำเร็จใน 1,738 ms โดยใช้ ChallengerAccess เดิม ไม่ได้เปลี่ยน IAM/profile; full investigation ผ่าน Agent/Step Functions ยังต้องตรวจแยก
- ดูผลล่าสุดใน [รายงาน deployment](cloud-deployment-status.md)

## Deploy ด้วยสิทธิ์ปัจจุบัน

ใช้ profile `ntt-fast` เดิมกับ Lambda สคริปต์ตรวจ `iam:PassRole` ให้ Lambda ก่อน deploy ใช้ config ที่อยู่ใน ignored `data/cloud-config.json` รัน:

```powershell
powershell -NoProfile -File scripts/deploy-cloud.ps1 -ConfigPath data/cloud-config.json
```

สคริปต์ตรวจ account ID, ใช้ Singapore, ตั้ง `EnableIoT=false` และเปิด mock signal เฉพาะ STAFF มี budget alert US$50 ต่อเดือน ซึ่งไม่ใช่ spending cap ไม่ต้องส่ง access keys หรือรหัสผ่านให้ผู้พัฒนา

## อ้างอิง

- [AgentCore Runtime IAM permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html)
- [AgentCore CreateAgentRuntime dependent PassRole permission](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-agentcore.html)
- [App Runner managed policy: PassedToService ใช้ apprunner.amazonaws.com](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSAppRunnerFullAccess.html)
