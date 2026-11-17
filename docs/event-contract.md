# Shelf event contract

The ESP32 and simulator publish the same event shape. The local server validates it before any cart mutation.

| Field | Required | Example | Rule |
| --- | --- | --- | --- |
| eventId | Yes | esp32-1a2b-14 | Idempotency key; repeated IDs are ignored |
| shelfId | Required for multi-shelf / AWS device events; optional in the one-shelf local simulator | SHELF-01 | Identifies the shelf-level product mapping |
| laneId | Yes | LANE-1 | Valid lane names are checked before mapping. Shelf 1 maps valid lanes to Cola; Shelf 2 maps valid lanes to Sprite Plus Tea |
| sku | No | COKE | Validated against the lane, then the shelf mapping selects the cart SKU; the source value is retained for evidence/audit when remapped |
| eventType | Yes | PICK | PICK or PUT_BACK |
| timestamp | No | 2026-10-03T10:30:00Z | ISO timestamp from the device; server also records receivedAt |
| delayed | No | false | `true` when the event is queued offline/backlogged or retried without an application ACK; staff must review it |
| rssi.A / rssi.B | Yes as an object | -51 / -72 | Integer dBm in [-127, 0]; null means no fresh tag was seen |

Example payload:

    {
      "eventId": "demo-0001",
      "shelfId": "SHELF-01",
      "laneId": "LANE-1",
      "sku": "COKE",
      "eventType": "PICK",
      "timestamp": "2026-10-03T10:30:00Z",
      "delayed": false,
      "rssi": { "A": -51, "B": -72 }
    }

## Decision table

| Evidence | Case manager | Cart effect | Next action |
| --- | --- | --- | --- |
| Both readings and lead ≥ 10 dB; active session | Not called | Apply PICK/PUT_BACK deterministically | Continue |
| Exactly one active basket session and its fresh RSSI is at least `SINGLE_BASKET_MIN_RSSI` (default -80 dBm) | Not called | Apply deterministically if event is not delayed and PUT_BACK quantity exists | Continue |
| Both readings and lead < 10 dB | Called only for this ambiguous case | No mutation while pending | Customer YES or staff |
| Tied readings or low recommendation confidence | Called for ambiguous case | No mutation while pending | Staff HITL |
| Missing/stale tag evidence | Not called | No mutation; zone remains unknown | Staff HITL |
| Device marks the event delayed | Not called | No mutation; stale RSSI is not assigned to a basket | Staff HITL |
| Clear zone but no basket session | Not called | No mutation | Staff HITL |
| PUT_BACK with no confirmed quantity | Not called | No negative quantity | Conflict case to staff |
| Duplicate eventId | Not called | No mutation | Return duplicate |

All cart mutations run through the same validator. A case can close as rejected without changing a cart. Only confirmed cart lines contribute to subtotal, total and mock checkout.


Hardware integration: rssi.HV01 optionally carries high-value tag proximity and is preserved in the event/evidence tools. It never substitutes for missing A/B tags or adds/removes an asset in a cart. Only PICK and PUT_BACK enter /api/events; telemetry is a separate MQTT diagnostic topic and is not ingested as a cart event. Device delivery uses the events topic and plain-eventId application ACK on the matching shelf /acks topic. Retries/backlog carry delayed:true; deduplication runs before delayed quarantine.
