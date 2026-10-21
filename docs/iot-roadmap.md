# Primary IoT roadmap

Accepted on 2026-10-09. This is the primary plan for IoT work in Basketly. It takes precedence over older hardware delivery and AWS-first provisioning instructions. The existing firmware is a draft; the milestones below describe planned work, not completed capabilities.

## Delivery order and equipment

1. ESP32 and two switches: real shelf events into the local app.
2. Three iBeacon Bluetooth IP67 tags: Basket A, Basket B and one high-value item.
3. AWS IoT Core: MQTT/TLS device communication, with the local app retained for validation.

Use one ESP32-WROOM-32, one KW11-N and one KW12 roller microswitch, and three iBeacon Bluetooth IP67 tags. The first physical demo has one product per switch. Two-item lane counting is a later mechanical upgrade.

The high-value item's beacon initially provides shelf proximity observations. It does not prove which basket carries the item. Another location requires another receiver. BLE is the prototype choice for this item; a future Wiliot integration is outside these milestones.

## Milestone 1: switches and the local app

### Wiring and mounts

| Component | Connection / role |
| --- | --- |
| ESP32-WROOM-32 | USB power/programming; 2.4 GHz Wi-Fi |
| Coke switch | COM to GND; NO to GPIO26 |
| Water switch | COM to GND; NO to GPIO27 |
| Product mounts | One item per switch; the item presses the roller while present |

Confirm COM and NO using terminal markings or a continuity test. Configure both GPIOs as INPUT_PULLUP: pressed/LOW means product present. GPIO logic is 3.3 V. Include a Micro-USB data cable, jumper wires, suitable switch-terminal connections and two simple mounts.

### Firmware and connection

- The cloud-path firmware in this branch uses AWS_MQTT; serial/local-HTTP transport modes are not included.
- Validate switches through USB serial first; then POST events to the existing /api/events endpoint.
- Run the laptop server with HOST=0.0.0.0 on a private network. Configure the ESP32 with the laptop's LAN address; both devices use the same network.
- Preserve the existing event fields: event ID, shelf, lane, SKU, event type and basket RSSI. Before beacons arrive, send rssi: {A: null, B: null}.
- Initialize switch states at startup without emitting an event. Require 80 ms of stable input before emitting PICK or PUT_BACK.
- Sample switches independently of network requests so reconnects cannot hide transitions.
- Retain up to eight events in RAM. Retry the same event ID until the local API bridge acknowledges ingestion; expose queue overflow over USB serial.
- Generate event IDs using a boot identifier and sequence number. Omit the device timestamp until time is synchronized.
- With no BLE evidence, route events to existing staff review. Staff can approve events into an active basket; do not synthesize basket readings.

Completion: removing/replacing either product appears in the staff dashboard and can update the correct cart through staff approval.

## Milestone 2: basket beacons and high-value item monitoring

| Beacon | Assignment | iBeacon major / minor |
| --- | --- | --- |
| 1 | Basket A | 1 / 1 |
| 2 | Basket B | 1 / 2 |
| 3 | High-value item HV-001 | 1 / 3 |

- Configure one project UUID and distinct major/minor identities. Use iBeacon advertisements at 200 ms intervals and equal transmit power across tags.
- Identify tags by UUID/major/minor; record MAC addresses for diagnostics. The documented factory iBeacon identifiers are shared defaults and must be changed.
- Scan continuously using NimBLE-Arduino. Store timestamped samples and take the median of up to five readings from the preceding five seconds.
- Send null when a basket has no fresh samples. Start with the existing 10 dB basket comparison threshold and calibrate it on the physical shelf.
- Preserve existing confirmation/review behavior for missing, tied or ambiguous basket evidence.

The current cart-event firmware uses the Basket A/B tags only. The third high-value-item telemetry/tag monitor is a separate scope and is not required to assign cart events.

### Telemetry and app interfaces

Add POST /api/telemetry once per second, carrying device ID, uptime, queue depth, dropped-event count, basket RSSI, and high-value tag ID/RSSI/latest-observation age. Extend /api/state and existing live updates with device and item-monitor data.

Display the high-value item as:

- Recently seen: an observation within five seconds.
- Stale: previously observed, but no fresh reading.
- Not yet seen: no observation since startup.
- Receiver offline: no telemetry for ten seconds.

Show last-seen time and RSSI history. Label the receiver SHELF-01. Reception means this receiver heard the tag, not that its precise position or basket is known. The third tag does not generate cart additions/removals.

## Milestone 3: AWS device path

- Preserve the event and telemetry payloads when switching transports.
- Provision an IoT thing, X.509 certificate and restricted topic permissions. Keep real credentials outside version control.
- Publish through verified MQTT/TLS to smartbasket/shelf/SHELF-01/events and smartbasket/shelf/SHELF-01/telemetry.
- Add a laptop bridge that subscribes through IoT Core and forwards messages to the local API.
- Have the bridge acknowledge events only after successful API ingestion; firmware retains queued events until that acknowledgement arrives.
- Mark queued events as delayed and route them to staff review, preventing old proximity evidence from automatically changing carts.

The source implementation is in `scripts/iot-bridge.mjs`, `infra/aws-iot/policies/` and `firmware/esp32/smart_shelf.ino`. AWS resource creation, certificates and physical verification remain operator steps.

This establishes the AWS device path and now includes an optional DynamoDB persistence adapter for the existing Node API. The API still runs locally and consumes the state through one versioned prototype item. Lambda/API Gateway, a normalized multi-item data model, Step Functions and a hosted application are subsequent backend milestones.

## Verification and acceptance

- Compile BLE-disabled and BLE-enabled firmware; record working Arduino core and library versions.
- Perform 30 pick/return cycles per switch: one event per transition, no boot events and no cross-lane events.
- Test bounce, simultaneous transitions, Wi-Fi loss, retries, overflow and reboot.
- Confirm missing BLE never automatically assigns an item and duplicate deliveries never double-count.
- Test Basket A near, Basket B near, both together, missing tags and unrelated advertisements.
- Move HV-001 away and back; verify seen/stale recovery and receiver-offline behavior.
- Target less than 1.5 seconds from stable switch transition to the local screen during normal connectivity.
- Run existing software tests plus tests for telemetry freshness, offline behavior and delayed-event review. Repeat physical checks through AWS before making it the default transport.

RAM-queued events can be lost on power failure. Persistent buffering, two-item lane counting and tracking across additional zones are later upgrades.

## Equipment references

- [ESP32 listing](https://www.modulemore.com/product/128/esp32-wroom-32-dev-board-wifi-bt-ble-mcu)
- [Roller microswitch listing](https://www.modulemore.com/product/2128/%E0%B8%A5%E0%B8%B4%E0%B8%A1%E0%B8%B4%E0%B8%95%E0%B8%AA%E0%B8%A7%E0%B8%B4%E0%B8%95%E0%B8%8B%E0%B9%8C-limit-switch-kw11-n-kw12-micro-switch-with-red-wheel)
- iBeacon Bluetooth IP67 tags: configure a shared UUID and unique major/minor values using the tag vendor's supported app before pairing with the firmware.
- [Espressif GPIO documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/gpio.html)
- [AWS IoT certificates](https://docs.aws.amazon.com/iot/latest/developerguide/x509-client-certs.html)
