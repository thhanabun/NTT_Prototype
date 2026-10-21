# ESP32 shelf firmware

The sketch targets ESP32-WROOM-32, KW11-N/KW12 roller microswitches and configurable iBeacon Bluetooth IP67 basket tags. It debounces each product lane, samples switches in a separate FreeRTOS task, and uses the median of five fresh RSSI readings to create shelf events.

## Wiring

| Part | Connection | Meaning |
| --- | --- | --- |
| Coke KW11-N switch | COM → GND, NO → GPIO26 | Product present while roller is pressed |
| Water KW12 switch | COM → GND, NO → GPIO27 | Product present while roller is pressed |
| Basket A iBeacon | UUID + major/minor `1 / 1` | RSSI evidence for basket A |
| Basket B iBeacon | Same UUID, major/minor `1 / 2` | RSSI evidence for basket B |

Both GPIOs use `INPUT_PULLUP`; pressed/LOW means product present. Removing it emits `PICK`; restoring it emits `PUT_BACK`. Confirm COM/NO with a continuity meter and mount each switch so the product reliably presses the red roller. The third high-value-item beacon is not used by this cart-event path.

## Event delivery

The ESP32 publishes to `smartbasket/shelf/SHELF-01/events` over MQTT/TLS. The local bridge forwards each event to `POST /api/events` and publishes the event ID to `smartbasket/shelf/SHELF-01/acks` only after the API returns success. The eight-entry RAM queue retains that ID until the application ACK. Events queued offline, backlogged behind an unacknowledged event or retried are marked `delayed: true`, which routes them to staff instead of changing a cart automatically. Duplicate API ingestion remains idempotent.

The input task continues through Wi-Fi/MQTT reconnects. Queue overflow is written to USB serial. The queue is RAM-only, so power loss can discard queued events.

## Build and provision

1. Use ESP32 Arduino core, PubSubClient and NimBLE-Arduino 2.x.
2. Configure the two basket tags with one project UUID and major/minor values 1/1 and 1/2. Put that UUID in `esp32/secrets.h`; example values are placeholders.
3. Follow [AWS IoT Core setup](../infra/aws-iot/README.md) to create separate device and bridge certificates, policies and endpoint.
4. Copy `esp32/secrets.example.h` to `esp32/secrets.h`; fill Wi-Fi, endpoint, root CA, device certificate/private key and beacon UUID. `secrets.h` and `esp32/certs/` are ignored by Git.
5. Open `esp32/smart_shelf.ino` in Arduino IDE or PlatformIO and select ESP32 Dev Module / ESP32-WROOM-32.

No credentials or deployed AWS resources are included. The sketch initializes switches without a boot event and omits device timestamps until NTP time is available. RSSI indicates proximity to the shelf, not proof of who picked up the item.
