# Admin chat controls and live camera

## Chat

Open the Admin chat from the FAST floating menu or the `+` beside result tabs. Both typed commands and quick buttons are available:

| Request | Result |
| --- | --- |
| `สลับธีม`, `เปลี่ยนธีมเป็นมืด`, `theme day` | Set/toggle the existing site theme; keep the same localStorage preference as the header toggle |
| `แสดงจุด`, `แสดง Heatmap`, `สลับจุดกับ heatmap` | Change the Dashboard map for either recorded or live mode |
| `ดูเคสรออนุมัติ`, `Approve CASE-001` | Show current case cards with Basket A/B selection and Approve/Reject buttons |
| Daily sales / top products | Continue to use the existing real Laya statistics planner and result tabs |

Screen commands use a small explicit client-side command parser, labelled `คำสั่งหน้าจอ`; they do not claim a Laya decision. Send one screen command at a time. Negated/mixed commands ask for a single explicit command. The parser never executes code, SQL or arbitrary tool names.

Typing Approve does **not** mutate a cart. The staff member must inspect the card, choose a basket and click the existing StaffActions button. Those buttons keep the active-session, return-quantity, Agent-running and stale-state checks. The existing staff API performs the final validation and records its normal audit. Case cards read the same latest snapshot as Dashboard (up to 30 loaded cases), and completed/stale cases cannot silently be approved again.

## Live camera on the device opening Admin

1. Keep API, Laya, MQTT and Web running as usual.
2. Restart **only YOLO** after this update: Ctrl+C in its terminal, then `npm run model:vision` from the repository root. The old running Python process does not reload source automatically.
3. Open Admin → Object Detection → **กล้องสด**.
4. Choose the primary/rear camera, front camera or an enumerated webcam, then press **เชื่อมต่อกล้อง** and grant the browser's camera permission. No audio is requested.
5. The browser sends downscaled JPEG samples to the same-origin `/local-vision/live` route. That route forwards to the configured server-side vision service's `/live` endpoint. YOLO11n detects people; ByteTrack supplies track IDs. Annotated canvas and map samples use the same captured frame, rather than drawing an old box over a newer camera frame.
6. Use **หยุดกล้อง** when finished. Switching to the recording, leaving Dashboard, signing out or unmounting closes media tracks and aborts pending requests. Hidden browser tabs pause frame sampling. Returning to Dashboard requires reconnecting.

This mode uses the camera on **the device that opens Admin**, not a phone-to-desktop relay. A phone can use its own front/rear camera; a desktop can use its own built-in/USB webcam.

## Calibrate before drawing floor positions

Keep the camera fixed. Press **ปรับเทียบแผนที่** to freeze a frame:

1. Click four corners of the floor area in order: top-left, top-right, bottom-right, bottom-left. They must describe a rectangle on the actual floor, which appears as a quadrilateral in the camera image. Do not use tabletop corners.
2. Click the estimated centre of each shelf footprint on the floor: Shelf 1, then 2, then 3.
3. Sampling resumes. The bottom-centre of each tracked box is projected with the floor homography into a normalized map. Points outside the mapped area are omitted.

Touch input works too. For keyboard input, focus the calibration canvas, move the crosshair with arrows and select with Enter. Restart/cancel calibration buttons are available. No map position is invented before calibration.

Select a Basket A/B beside each visible Customer ID to label it manually. New tracks start as `Customer #ID`, never as a guessed Basket. Only one track is assigned to each basket at a time. Crossing/occlusion and leaving the frame can change IDs; inspect/reassign when necessary. This is not face identification or BLE ownership confirmation.

Map points show a recent six-second trail. Heatmap accumulates a bounded rolling history of at most 600 inference samples (about five minutes at the target two samples/second). Calibration and history are session-local and reset on camera changes. If the camera moves, is rotated, or changes zoom, recalibrate. There is no measured-metre scale or lens calibration; bounding-box feet may shift when occluded.

## Webcam vs mobile HTTPS

On the same PC, `http://localhost:3001` is a secure context for browser camera access. On a phone opening `http://<PC-IP>:3001`, plain LAN HTTP is **not** sufficient. Use HTTPS with a certificate trusted by the phone and covering the hostname/IP used.

An HTTPS development entry point is available (stop the old Web instance on port 3001 first):

```powershell
# Example LAN address; replace it with this PC's actual LAN hostname/IP.
$env:LOCAL_DEV_HOSTS = "192.168.1.50"
$env:LOCAL_API_ORIGIN = "http://127.0.0.1:3000"
npm --prefix web run dev:mock:https
```

Next generates a self-signed certificate by default. That alone does **not** make it trusted by another phone. With your own trusted LAN certificate, pass its files:

```powershell
npm --prefix web run dev:mock:https -- --experimental-https-key C:\certs\local-key.pem --experimental-https-cert C:\certs\local-cert.pem
```

Then open `https://<PC-IP>:3001/admin` on the phone. Keep both devices on the same LAN and keep local services private. This change does not alter firewall rules, create a tunnel or expose the model service to the network.

## Runtime boundaries

- Target capture rate: at most two frames/second per browser, sequential requests without overlap; CPU/model latency reduces the actual rate.
- Only JPEG requests up to 512,000 bytes and images up to 1280×720 are accepted; the UI usually sends width ≤640, height ≤720. No URLs or filesystem paths are accepted from a camera request.
- At most four in-memory tracker sessions; inactive sessions expire after 60 seconds. The model lock serializes inference. Live images/results are not written to disk, carts, case evidence or audit records.
- The existing `/infer {frameId}` evidence tool remains unchanged. Live boxes are display data, and do not authorize cart mutations.
- `/local-vision/live` uses the local vision service in `dev:mock`. In cloud mode it requires a STAFF cookie and forwards bounded JPEG frames through the same-origin HTTPS BFF → authenticated Lambda API → private Agent Lambda → loopback YOLO service. The Agent has no public Function URL; only backend IAM roles can invoke it. No AWS credentials reach the browser. Both paths check origin, size and session format, and do not add wildcard CORS. Production outside cloud mode keeps this route disabled.
- The annotated recording remains available without a webcam or the live service.

Static validation: TypeScript, ESLint and production compilation. Physical webcam/mobile capture, camera permission handling on actual devices, tracking accuracy and staff mutations still need an explicit integration run with the team; no full test suite or physical-camera session was run during this change.
