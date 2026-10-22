# YOLO11n evidence tool

The Agent can choose `inspect_vision_evidence` like any other evidence tool. It runs **real YOLO11n** on CPU through a separate local HTTP service. Laya chooses actions and basket recommendations; YOLO detects generic objects in pixels. Selecting this tool is optional, never a forced stage of the live Agent loop.

## Start

Use Python 3.12 and a separate terminal at the repository root:

```powershell
powershell -NoProfile -File scripts/start-vision.ps1 -Python C:\path\to\python312.exe -Install
```

After setup: `npm run model:vision`. This creates `.venv-vision`, downloads hash-pinned official weights and the demo image into ignored `data/vision`, loads/warmups the model, then serves `127.0.0.1:8001`. It does not change the Laya environment. `GET /health` reports readiness/model/hash. `POST /infer` accepts only `{"frameId":"demo-people"}`. The service has no uploads, URL fetcher, filesystem path argument or camera capture. Downloads happen during setup, not inference.

Node uses `VISION_ENDPOINT=http://127.0.0.1:8001/infer` by default. The Lambda tool handler awaits the same async adapter; cloud requires an accessible hosted service and registered assets. Localhost in Lambda does not reach this PC. No AWS resources are deployed here.

Keep Laya, API, MQTT broker and Shopper A/B sessions running from this branch, then:

```powershell
npm run mock:evidence -- vision
```

This sends MQTT telemetry and an ambiguous PICK with `mockVisionFrameId: demo-people`. The application atomically links the MOCK frame before starting investigation. The planner sees frame availability, chooses its actions, and may inspect the image, choose other tools, decide or escalate. It does not have to call YOLO every time. Open Staff case details → Agentic investigation/tool calls to inspect the trace and full detections.

Existing `POST /api/evidence/camera` also accepts optional `frameId` on an existing event. Metadata arriving after a tool ran does not retroactively rerun that tool. Prefer the atomic mock signal for this demo. Inputs remain limited to identifiers; the service resolves the approved frame from `infra/vision/assets.json` and verifies SHA-256 on each inference.

## Evidence contract and safety

- Tool arguments are only `eventId`, bound to the current case. It reads at most two linked frames and returns at most 20 detections per image.
- Result includes model/weights hash, frame hash/source, dimensions, inference time, class, object confidence and pixel-coordinate `[x1,y1,x2,y2]` boxes. Results appear in persisted case tool calls; the existing audit records tool completion. Image bytes stay out of cart state/DynamoDB/SSE.
- The official example image contains people, not this shelf. It is labelled **MOCK** by the service even if submitted metadata says CAMERA. `aligned: false` is intentional: these fixtures cannot corroborate event timing. Missing frames return `NO_DATA`; service failures/invalid outputs return `UNAVAILABLE`, with no fabricated detections. An overall Agent timeout still escalates to staff.
- No detections means no detected objects at the configured threshold; it does not establish an empty shelf. Static COCO detection cannot establish Coke vs Water, Basket A/B ownership, a hand removing/returning an item, or PICK/PUT_BACK direction. Object confidence is never promoted to basket confidence. Human confirmation and existing deterministic guards remain required for ambiguous cart updates.
- Real shelf images, RTSP acquisition, calibrated lane regions, tracking/before-after comparison and SKU-specific training remain future integrations. Nothing here claims retail detection accuracy.

## Verification

`npm test` covers frame validation/provenance, malformed responses, missing/unavailable service and an async Agent-selected tool with cart/audit guards. `npm run verify:vision` requires the vision and Laya services: it uses isolated DB state, real YOLO, real Laya decisions and both a labelled planner fixture (guarantees vision-path coverage) and a separate unforced real-planner run. It records which tools the real planner actually chose; a fixture is not proof of autonomous tool selection.

The live CPU planner can exceed the existing 25-second investigation deadline while choosing several tools. Verification explicitly checks staff routing and unchanged carts if this happens, records `agentStatus: FAILED` and the reason, and does not label that run a completed basket-model decision. The fixture run must complete with a real Laya basket decision. This integration does not relax the deadline or replace the live planner with a fixture.

### Observed checks, 22 October 2026

- Node regression: **43/43 passed**. Python service compiled and `pip check` found no broken requirements.
- Actual CPU inference detected two people and a tie in the official MOCK photo. Inference was roughly 99–137 ms in these warmed-up sample calls; this is not a shelf-accuracy or end-to-end latency benchmark.
- `data/vision-verification-1792661098263/report.json`: fixture-selected vision/core-tool path completed with real YOLO and Laya decision (basket probability 0.46). The separate unforced planner selected vision first, then more tools, and hit the 25-second deadline; staff routing, unchanged pre-human carts, approval, idempotency, checkout and persistence passed. The earlier verification assertion rejected this deadline as incomplete; it was then made an explicit, reported failure-path check.
- `data/vision-mqtt-smoke/report.json`: the actual `mock:evidence vision` CLI ran through an isolated production local MQTT broker and HTTP API with real Laya/YOLO. Laya selected `inspect_vision_evidence → get_shelf_event → get_cart_history → get_basket_evidence → get_signal_window → DECIDE`; investigation **COMPLETED**, basket A probability **0.3876**, therefore staff approval required. MQTT application ACK arrived, cart total stayed zero until approval, then became ฿25. Existing team API/broker/database were not reset. This was an API/MQTT check, not a new browser or physical-hardware run.

## Sources and license

- [Official YOLO11 model documentation](https://docs.ultralytics.com/models/yolo11/) describes nano `yolo11n.pt` and pretrained COCO detection.
- [Official predict API](https://docs.ultralytics.com/modes/predict/) documents detection results/boxes.
- Runtime pinned to `ultralytics==8.3.235`, CPU `torch==2.6.0` / `torchvision==0.21.0`; assets, download URLs and hashes are in `infra/vision/assets.json`.
- Ultralytics code/models are offered under [AGPL-3.0 or an Enterprise license](https://www.ultralytics.com/license). This integration does not change those terms; review the license before distributing a proprietary deployment.
