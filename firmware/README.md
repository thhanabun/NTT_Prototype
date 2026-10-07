# ESP32 shelf firmware

The sketch watches one microswitch per lane and continuously scans the two BLE basket tags. It debounces shelf-state changes, takes a rolling median of the last five tag readings, and publishes one idempotent event for each stable transition. A bounded eight-event RAM outbox retries while Wi-Fi/MQTT reconnects; a power loss or a longer outage can still lose queued events.

## Wiring

| Part | ESP32 pin | Notes |
| --- | --- | --- |
| Coke lane switch | GPIO 26 to GND | INPUT_PULLUP; closed means product is present |
| Water lane switch | GPIO 27 to GND | INPUT_PULLUP; closed means product is present |
| Hall sensor alternative | GPIO 26 / 27 | Use a digital output module compatible with 3.3 V |
| BLE Basket A | BLE advertisement | Set its MAC in BASKET_A_MAC |
| BLE Basket B | BLE advertisement | Set its MAC in BASKET_B_MAC |

When a lane changes from product-present to empty, the firmware sends PICK. When product-present returns, it sends PUT_BACK. Mount and test the switch so these two states are reliable before attaching the shelf.

## Build and provision

1. Use an ESP32 Arduino core, PubSubClient, and NimBLE-Arduino 2.x.
2. Copy esp32/secrets.example.h to esp32/secrets.h; set Wi-Fi, IoT endpoint, root CA, device certificate, and private key. The real secrets file is ignored by Git.
3. Set the two basket-tag MAC addresses in smart_shelf.ino.
4. Add an AWS IoT policy allowing iot:Connect for this client and iot:Publish only to smartbasket/shelf/SHELF-01/events.
5. Open the sketch in Arduino IDE or PlatformIO and select the matching ESP32 board.

No device certificate or AWS account is included in this repository. BLE RSSI is zone evidence, not proof of who physically picked up an item.
