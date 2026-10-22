# Store Map Presence (ESP32 → Server)

The store map shows **which shelf a basket is near**, not an (x, y) position. Each shelf ESP32 reports the basket RSSI it hears. The server turns those reports into one shelf zone per basket and pushes the result to phones over SSE. This path is separate from the cart: it does not touch `/api/events`, carts, checkout, cases or the audit log.

```
ESP32 (SHELF-01, SHELF-02 …)
  └─ MQTT  smartbasket/shelf/<id>/presence   (QoS0, every 500 ms)
        └─ broker  tools/mqtt-broker/broker.mjs
              └─ POST /api/presence          (latest report wins, no ACK)
                    └─ src/presence.mjs      (zone + hysteresis, in memory)
                          └─ SSE /api/stream  event: presence  (only when a zone changes)
```

A confirmed pick from `/api/events` (disposition `CONFIRMED`, clear RSSI lead) also pins that basket to the pick's shelf for 8 s. Ambiguous or pending picks do not move the map.

## ESP32 payload

Topic: `smartbasket/shelf/<SHELF_ID>/presence`

```json
{"shelfId":"SHELF-01","seq":42,"uptimeMs":123456,
 "rssi":{"A":-55,"B":null},"ageMs":{"A":120,"B":null}}
```

- `rssi` is the existing 5-sample median (`shelfFreshMedian`). It is `null` when the basket has not been heard for 5 s.
- `ageMs` is the time since that basket's last BLE packet. The server uses it so late MQTT delivery cannot make an old reading look fresh.
- The payload is built by `shelfPresencePayload()` in `firmware/esp32/shelf_protocol.h` and covered by `tests/firmware/protocol_test.cpp`.

The 1 Hz `/telemetry` topic stays as it was. It carries diagnostics only and is not forwarded.

## Firmware settings (`secrets.h`)

| Define | Default | Use |
|---|---|---|
| `SHELF_DEVICE_ID` | `"SHELF-01"` | Shelf ID used in every MQTT topic and in the client ID |
| `SHELF_ENABLE_SWITCHES` | `1` | `0` = BLE presence only, never sends PICK/PUT_BACK |
| `SHELF_PRESENCE_INTERVAL_MS` | `500` | Presence publish interval |

### Adding a second shelf (presence only)

To flash a second ESP32 with `local_shelf.ino`, put this in its `secrets.h`:

```cpp
#define SHELF_DEVICE_ID "SHELF-02"
#define SHELF_ENABLE_SWITCHES 0
```

The server domain has one shelf with Coke/Water lanes, so extra shelves should send presence only.

### ESP32-S3 boards

The same sketch builds for ESP32-S3. On S3, GPIO 26–32 drive the flash/PSRAM and GPIO 22–25 do not exist, so the S3 build automatically uses GPIO 4/5 for the switches and a safe pin probe list. Override with `SHELF_COKE_PIN` / `SHELF_WATER_PIN` in `secrets.h`. Use the `huge_app` partition:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app --build-path tmp/shelf-s3-build firmware/esp32/local_shelf
arduino-cli upload --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app,UploadSpeed=921600 --port COM8 --input-dir tmp/shelf-s3-build firmware/esp32/local_shelf
```

Tested toolchain: ESP32 core 3.3.12, NimBLE-Arduino 2.5.1, PubSubClient 2.8.0. NimBLE 2.2.0 boot-loops on core 3.3.12.

## Server API

- `POST /api/presence` takes the payload above and returns `{ "ok": true, "changed": bool }`. Invalid `shelfId` → 409.
- `GET /api/presence` returns the current snapshot.
- `GET /api/stream` sends `event: presence` with the same snapshot on connect and whenever a zone changes or a shelf goes online or offline. It does not send on every RSSI change. Existing clients that listen only to `state` are unaffected.

```json
{
  "updatedAt": "2026-10-22T10:00:00.000Z",
  "thresholds": { "enterDbm": -70, "exitDbm": -80, "staleMs": 4000 },
  "baskets": [
    { "basketId": "A", "zone": "SHELF-01", "since": "…", "source": "RSSI", "rssi": { "SHELF-01": -62, "SHELF-02": null } },
    { "basketId": "B", "zone": null, "since": null, "source": null, "rssi": { "SHELF-01": null, "SHELF-02": null } }
  ],
  "shelves": [{ "shelfId": "SHELF-01", "lastReportAt": "…", "online": true }]
}
```

`source` is `"PICK"` while a confirmed pick holds the basket, `"RSSI"` otherwise, and `null` when the basket is near no shelf.

## Zone rules and calibration

| Env var | Default | Meaning |
|---|---|---|
| `PRESENCE_ENTER_DBM` | -70 | A basket enters a shelf zone at this RSSI or stronger |
| `PRESENCE_EXIT_DBM` | -80 | It stays in the zone until RSSI drops below this |
| `PRESENCE_SWITCH_MARGIN_DB` | 6 | Another shelf must be this much stronger to take over |
| `PRESENCE_STALE_MS` | 4000 | Readings and shelves older than this are ignored |
| `PRESENCE_PICK_HOLD_MS` | 8000 | How long a confirmed pick pins the basket |

Calibrate these on site:
1. Run the broker with `LOG_PRESENCE=true`.
2. Stand with a basket where a shopper would pick from the shelf. Note the RSSI and set `ENTER` about 3 dB weaker than that.
3. Walk to the aisle position that should count as "left the shelf". Set `EXIT` at that RSSI.
4. Set the DX-CP101 beacons to advertise every 100–300 ms. With the 5-sample median, the map then reacts in about 1 s.

## Tests

- `tests/presence.test.mjs` covers enter and exit hysteresis, shelf takeover margin, staleness, the pick pin and input validation.
- `tests/broker-forward.test.mjs` covers forwarding to `/api/presence`, latest-wins per shelf and error handling.
- `tests/firmware/protocol_test.cpp` covers topic building and the presence payload. Build it with `g++ -std=c++17 -I tests/firmware tests/firmware/protocol_test.cpp`.
