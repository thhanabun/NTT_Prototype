# FAST local setup (Windows / PowerShell)

Prerequisites: Node.js 24 LTS recommended and Python 3.12 installed. Run from the repository root. No AWS credentials are required for the local stack.

## First setup

Stop existing local services before installing dependencies, then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Install
```

If Python 3.12 is not the default `python`, append `-Python 'C:\path\to\Python312\python.exe'`. Existing virtual environments retain their interpreter; changing `-Python` only affects newly created environments.

The launcher installs backend/web lockfile dependencies, then starts five background services. The existing model scripts install their pinned Python requirements, download model assets and load them. First setup needs internet and can take several minutes. A launched PID does not mean its model is ready; inspect the logs for startup failures.

## Subsequent starts

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

| Service | Port | Purpose |
| --- | --- | --- |
| Laya | 8000 | Real local agent model |
| YOLO | 8001 | Agent's still-image evidence tool |
| API | 3000 | FSM, carts, cases, audit and local JSON persistence |
| MQTT | 1883 | ESP32 events/telemetry forwarded to the API |
| Web | 3001 | Shopper and Admin, including the recorded YOLO video/map |

- Shopper: <http://localhost:3001/shopper>
- Admin: <http://localhost:3001/admin>
- Local Admin account: `admin@basketly.test` / `BasketlyDemo123!`

The launcher uses real Laya in agentic mode, a single-basket RSSI minimum of -80 dBm, and local persistence. It respects an existing `STORE_PATH`; otherwise it reuses `data/local-demo-new.json` if present, falling back to `data/demo-state.json`. It does not clear state.

Occupied ports are skipped with a warning; an occupied port is not proof that the correct service/configuration is running. Restart an existing API manually when its code/settings change. Do not launch another instance on the same port.

## Logs / foreground mode

Background stdout and stderr are in `tmp/local-services`, with a timestamp per launch:

```powershell
Get-Content .\tmp\local-services\api-*.stderr.log -Tail 30
Get-Content .\tmp\local-services\laya-*.stdout.log -Tail 30
```

To see a service in a terminal instead, stop that service's existing instance, then use one terminal per service:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Service api
# Other services: -Service laya / vision / broker / web
```

Ctrl+C stops a foreground service. Background instances persist after the launcher exits; use Task Manager to stop the matching launched process and its children if required. The launcher prints their PIDs and never kills unrelated port owners automatically.

## Real customer video

For webcam/phone camera mode and chat commands, see [Admin controls and live camera](admin-controls-camera.md). Restart the YOLO terminal after updating its Python service.

The annotated WebM, poster and tracking metadata are already in `web`; normal startup does not reprocess the MOV or run video inference in the browser. YOLO port 8001 is the separate Agent evidence service. To regenerate the recorded clip, see [customer-detection.md](customer-detection.md).
