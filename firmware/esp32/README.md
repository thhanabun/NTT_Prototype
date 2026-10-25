# ESP32 Shelf Firmware

This directory contains the firmware implementations for the FAST Smart Shelf prototype (`SHELF-01` to `SHELF-03`).

---

## Firmware Architecture & Variants

| Sketch Path | Target / Role | Transport & Operating Mode |
| :--- | :--- | :--- |
| [`esp32.ino`](esp32.ino) | **Main Firmware (Local & Demo - Default)** | The primary sketch in `esp32/`. Pre-configured with the 3 physical beacon MACs. Runs standalone on USB Serial Monitor without Wi-Fi, or dispatches HTTP POST events to local server (`/api/events`). |
| [`local_shelf/local_shelf.ino`](local_shelf/local_shelf.ino) | **Local Shelf Standalone** | Local development implementation; the root esp32.ino includes this file. |
| [`aws_shelf/aws_shelf.ino`](aws_shelf/aws_shelf.ino) | **AWS IoT Core Firmware — Shelf 1** | Implements the source protocol described in [`esp32-firmware-requirements.md`](../../docs/esp32-firmware-requirements.md). Uses MQTT over TLS 1.2 (Port 8883) to **AWS IoT Core** with X.509 certificates, 1 Hz telemetry, and an 8-slot outbox. The current deployment report records the IoT signal path as user-reported; it does not include per-board acceptance evidence. |
| [`aws_shelf_02/aws_shelf_02.ino`](aws_shelf_02/aws_shelf_02.ino) | **AWS Shelf 2** | Uses the same TLS/MQTT protocol with the `SHELF-02` identity and its own certificate. Backend maps every Shelf 2 lane to Sprite Plus Tea. |
| [`aws_shelf_03/aws_shelf_03.ino`](aws_shelf_03/aws_shelf_03.ino) | **AWS Shelf 3** | Uses the same TLS/MQTT protocol with the `SHELF-03` identity, its own certificate, and GPIO 4/5 switch wiring reported by the connected ESP32-S3 board. |
| [`ble_test/ble_test.ino`](ble_test/ble_test.ino) | **Standalone BLE Scanner** | Scans, decodes, and calibrates DX-CP101 beacons and iBeacon tags with distance estimation and lead margin evaluation. |
| [`limit_switch_test/limit_switch_test.ino`](limit_switch_test/limit_switch_test.ino) | **Standalone Switch Test** | Tests mechanical roller switch debouncing on GPIO 26 without networking. |
| [`wifi_test/wifi_test.ino`](wifi_test/wifi_test.ino) | **Standalone Wi-Fi Test** | Validates 2.4 GHz WLAN connectivity and DHCP IP assignment. |

---

## Hardware Pinout & Wiring

Mechanical roller microswitches (KW11-N / KW12) connected to ESP32:

| Switch Terminal | ESP32 Pin | Logic Mode | State Description |
| :--- | :--- | :--- | :--- |
| **Coke Lane (LANE-1) NO** | **GPIO 26** | `INPUT_PULLUP` | Closed = `LOW` (Product Present), Open = `HIGH` (Empty / Picked) |
| **Water Lane (LANE-2) NO** | **GPIO 27** | `INPUT_PULLUP` | Closed = `LOW` (Product Present), Open = `HIGH` (Empty / Picked) |
| **Common (COM)** | **GND** | Ground | Both switches share a single common GND line |
| **Normally Closed (NC)** | *Unconnected* | - | Leave disconnected |

> [!NOTE]
> No external resistors or 5V/3.3V supplies are required. The internal `INPUT_PULLUP` resistors of the ESP32 are used.

---

## Configured BLE Beacons (3 Devices)

| Device | Role | Configured MAC | iBeacon Major / Minor |
| :--- | :--- | :--- | :--- |
| **Basket A** | Shopper A Cart | `48:87:2d:9e:3e:c5` (`48872D9E3EC5`) | `1` / `1` |
| **Basket B** | Shopper B Cart | `48:87:2d:9e:3c:0e` (`48872D9E3C0E`) | `1` / `2` |
| **High-Value Item** | Asset Tag (`HV-001`) | `48:87:2d:9e:3e:49` (`48872D9E3E49`) | `1` / `3` |

### Signal Processing & Decision Rules
- **Rolling Median**: Median of up to five samples, excluding each sample older than 5000 ms.
- **Freshness Window**: 5000 ms (`TAG_FRESH_MS`). Stale readings become `null`.
- **Proximity Lead ($\ge 10\text{ dB}$)**:
  - If `|RSSI_A - RSSI_B| >= 10 dB` $\rightarrow$ `CONFIRMED CLEAR LEAD` (assigned automatically).
  - If `|RSSI_A - RSSI_B| < 10 dB` $\rightarrow$ `AMBIGUOUS_ZONE` (backend model/policy selects customer confirmation or staff review).
- **High-Value Item Status**: Evaluates `RECENTLY_SEEN`, `STALE`, or `NOT_YET_SEEN`.

---

## How to Build and Flash

### 1. Local Testing Firmware (Default)

```powershell
# Compile local firmware
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/local-shelf-build firmware/esp32/local_shelf

# Upload to ESP32 (replace COM8 with your port)
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM8 --input-dir tmp/local-shelf-build firmware/esp32/local_shelf

# Open Serial Monitor
arduino-cli monitor --port COM8 --config baudrate=115200
```

### 2. AWS IoT Core Production Firmware

1. Ensure the shared `firmware/esp32/secrets.h` exists with Wi-Fi and beacon MAC settings.
2. Provision each device once. The script stores each private key under ignored `data/aws-device/` and writes the matching firmware credential header:

```powershell
.\scripts\provision-cloud-device.ps1 -ShelfId SHELF-02
.\scripts\provision-cloud-device.ps1 -ShelfId SHELF-03
```

3. Compile and upload the matching sketch (use the port of that ESP32):

```powershell
# Compile Shelf 1
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/aws-shelf-build firmware/esp32/aws_shelf

# Compile Shelf 2
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/aws-shelf-02-build firmware/esp32/aws_shelf_02

# Compile Shelf 3
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/aws-shelf-03-build firmware/esp32/aws_shelf_03

# Upload Shelf 1
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM8 --input-dir tmp/aws-shelf-build firmware/esp32/aws_shelf

# Upload Shelf 2
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM9 --input-dir tmp/aws-shelf-02-build firmware/esp32/aws_shelf_02

# Upload Shelf 3 (change FQBN if this board is ESP32-S3)
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM10 --input-dir tmp/aws-shelf-03-build firmware/esp32/aws_shelf_03
```


## Protocol review fixes

- Configure credentials in ignored secrets.h copied from the example. No real Wi-Fi passwords are embedded in the sketches.
- Local and AWS paths retain up to eight events until the backend application ACK on each shelf's `smartbasket/shelf/<SHELF-ID>/acks` topic. A successful MQTT publish does not remove an event. Retry unchanged IDs after three seconds; queued/offline/retried events carry delayed:true for staff review.
- Switches require 80 ms stable input and are sampled in a separate FreeRTOS task. Network connect/HTTP calls can block their own task without stopping input sampling.
- Explicit beacon MACs are authoritative. To use UUID/major/minor matching, leave the role MAC empty and configure SHELF_PROJECT_UUID. An unrelated beacon with matching default major/minor cannot replace a configured MAC.
- The median ages individual samples, so a new advertisement cannot revive old RSSI readings.
- Simulation commands are disabled unless SHELF_ENABLE_TEST_COMMANDS is explicitly enabled. Exact water_pick/water_put commands use lane 2 and do not overwrite the physical switch baseline.
- Telemetry is published/logged for diagnostics; the web backend's high-value telemetry/history/offline dashboard is not implemented by this firmware PR.
- RAM events are lost on power loss; buffer overflow is counted. No persistent outbox or claim of physical delivery/accuracy is made.
