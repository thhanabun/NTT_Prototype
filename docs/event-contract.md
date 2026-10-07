# Shelf event contract

The ESP32 and simulator publish the same event shape. The local server validates it before any cart mutation.

| Field | Required | Example | Rule |
| --- | --- | --- | --- |
| eventId | Yes | esp32-1a2b-14 | Idempotency key; repeated IDs are ignored |
| shelfId | No | SHELF-01 | Defaults to the configured demo shelf |
| laneId | Yes | LANE-1 | LANE-1 maps to COKE; LANE-2 maps to WATER |
| sku | No | COKE | If supplied, must match the lane |
| eventType | Yes | PICK | PICK or PUT_BACK |
| timestamp | No | 2026-10-03T10:30:00Z | ISO timestamp from the device; server also records receivedAt |
| rssi.A / rssi.B | Yes as an object | -51 / -72 | Integer dBm in [-127, 0]; null means no fresh tag was seen |

Example payload:

    {
      "eventId": "demo-0001",
      "shelfId": "SHELF-01",
      "laneId": "LANE-1",
      "sku": "COKE",
      "eventType": "PICK",
      "timestamp": "2026-10-03T10:30:00Z",
      "rssi": { "A": -51, "B": -72 }
    }

## Decision table

| Evidence | Case manager | Cart effect | Next action |
| --- | --- | --- | --- |
| Both readings and lead ≥ 10 dB; active session | Not called | Apply PICK/PUT_BACK deterministically | Continue |
| Both readings and lead < 10 dB | Called only for this ambiguous case | No mutation while pending | Customer YES or staff |
| Tied readings or low recommendation confidence | Called for ambiguous case | No mutation while pending | Staff HITL |
| Missing/stale tag evidence | Not called | No mutation; zone remains unknown | Staff HITL |
| Clear zone but no basket session | Not called | No mutation | Staff HITL |
| PUT_BACK with no confirmed quantity | Not called | No negative quantity | Conflict case to staff |
| Duplicate eventId | Not called | No mutation | Return duplicate |

All cart mutations run through the same validator. A case can close as rejected without changing a cart. Only confirmed cart lines contribute to subtotal, total and mock checkout.
