# ESP32 Shelf Firmware

This directory contains the firmware implementations for the Basketly Smart Shelf (`SHELF-01`).

---

## Firmware Architecture & Variants

| Sketch Path | Target / Role | Transport & Operating Mode |
| :--- | :--- | :--- |
| [`esp32/esp32.ino`](esp32/esp32.ino) | **Main Firmware (Local & Demo - Default)** | The primary sketch in `esp32/`. Pre-configured with the 3 physical beacon MACs. Runs standalone on USB Serial Monitor without Wi-Fi, or dispatches HTTP POST events to local server (`/api/events`). |
| [`esp32/local_shelf/local_shelf.ino`](esp32/local_shelf/local_shelf.ino) | **Local Shelf Standalone** | Identical local development sketch in its dedicated folder. |
| [`esp32/aws_shelf/aws_shelf.ino`](esp32/aws_shelf/aws_shelf.ino) | **AWS IoT Core Production Firmware** | Conforms 100% to [`esp32-firmware-requirements.md`](../docs/esp32-firmware-requirements.md). Uses MQTT over TLS 1.2 (Port 8883) to **AWS IoT Core** with X.509 certificates, 1 Hz telemetry, and 8-slot outbox. |
| [`esp32/ble_test/ble_test.ino`](esp32/ble_test/ble_test.ino) | **Standalone BLE Scanner** | Scans, decodes, and calibrates DX-CP101 beacons and iBeacon tags with distance estimation and lead margin evaluation. |
| [`esp32/limit_switch_test/limit_switch_test.ino`](esp32/limit_switch_test/limit_switch_test.ino) | **Standalone Switch Test** | Tests mechanical roller switch debouncing on GPIO 26 without networking. |
| [`esp32/wifi_test/wifi_test.ino`](esp32/wifi_test/wifi_test.ino) | **Standalone Wi-Fi Test** | Validates 2.4 GHz WLAN connectivity and DHCP IP assignment. |

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
- **Rolling Median**: 5-sample median window per beacon to eliminate multipath spikes.
- **Freshness Window**: 5000 ms (`TAG_FRESH_MS`). Stale readings become `null`.
- **Proximity Lead ($\ge 10\text{ dB}$)**:
  - If `|RSSI_A - RSSI_B| >= 10 dB` $\rightarrow$ `CONFIRMED CLEAR LEAD` (assigned automatically).
  - If `|RSSI_A - RSSI_B| < 10 dB` $\rightarrow$ `AMBIGUOUS_ZONE` (routes to customer confirmation).
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

1. Copy `esp32/secrets.example.h` to `esp32/secrets.h`.
2. Fill in your 2.4 GHz Wi-Fi credentials, AWS IoT Core endpoint, and X.509 certificates.
3. Compile and upload:

```powershell
# Compile AWS firmware
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path tmp/aws-shelf-build firmware/esp32/aws_shelf

# Upload to ESP32
arduino-cli upload --fqbn esp32:esp32:esp32:UploadSpeed=921600 --port COM8 --input-dir tmp/aws-shelf-build firmware/esp32/aws_shelf
```
