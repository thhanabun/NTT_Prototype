# Hardware PR #9: integration review

Reviewed 22 October 2026 (Asia/Bangkok). Original hardware head: 8268c60ba657f8d40ab2d17405412cc1f152a34e. Original base main: ded5e91a12747cf9b9772f5c9a73199fcd9c36f8. Backend/model baseline: 653cd409188bd32bcf13a96280bbaad768ce3c09.

At the start of review, PR #9 was OPEN, not merged into main. Its hardware code and the existing backend are integrated together because the older main backend did not implement delayed-event quarantine.

## Standards

Initial independent source review found six concrete problems: constexpr secrets treated as macros (AWS redefinition/local configuration ignored), hardcoded local Wi-Fi configuration, event loss before application acknowledgement, old RSSI samples revived by a new packet, Water commands matching Coke substrings, and UUID-free fallback for unrelated beacons.

Fixes use one shared firmware protocol header and one shared server-side forwarding helper. The root esp32.ino includes the local implementation rather than duplicating it. Local credentials come from ignored secrets.h; committed examples contain placeholders. Re-review found no remaining cart-event blocker. No cosmetic smell was promoted over correctness.

## Spec

Primary sources: docs/iot-roadmap.md, docs/esp32-firmware-requirements.md, docs/event-contract.md and the prototype session requirements.

- Eight pending events are retained until an exact eventId application ACK. A PubSubClient QoS0 write does not dequeue an event.
- Offline/backlogged/retried events contain delayed:true. The backend deduplicates IDs before delayed quarantine and never uses HV01 to replace missing basket evidence.
- Sensor sampling runs in a separate FreeRTOS task with 80 ms stable debounce. Network calls may still block their own task.
- The median excludes each RSSI sample older than five seconds. Configured MACs are authoritative; unbound roles require project UUID plus major/minor.
- Water simulation commands use exact matching and are disabled by default. Simulation does not change the physical switch baseline.
- The broker and AWS bridge acknowledge only successful API ingestion, using the same helper. Their HTTP deadline is 35 seconds, longer than the model's 30-second deadline. A shorter five-second bridge timeout was reproduced under concurrent compilation and corrected.
- The local HTTP fallback uses a separate TCP socket from MQTT.
- AWS client ID SHELF-01 matches the existing restricted device policy.
- The device policy permits both exact events and telemetry publish topics; otherwise the new heartbeat would be denied even though event publishing was allowed. The bridge still subscribes only to events.

Re-review found no remaining blocker for the cart-event contract. This does not establish every physical/nonfunctional target in the firmware specification.

## Verification

- Native C++ protocol assertions: exact Water commands, project UUID mismatch, per-sample RSSI expiry/clock rollover, ACK-only dequeue, FIFO, three-second retry, delayed flag and overflow counting.
- Existing native switch assertions: boot suppression, debounce restart, PICK/PUT_BACK and millis rollover.
- Node suite: 33/33 passed after integration, including broker failure/ACK ordering and optional HV01 evidence.
- Real local hardware-PR broker -> HTTP compute/FSM -> real Laya -> HITL/cart/JSON DB/audit/SSE: 19 assertions passed. Uses mocked device signals, not a flashed ESP32.
- Full ESP32 AWS build passed using Arduino core 3.3.12, NimBLE-Arduino 2.5.1, PubSubClient 2.8.0. The subsequent configured local/AWS builds and post-timeout-fix verification are recorded in the merge result below.

No device was flashed, and no AWS account resources or real certificates were used. Build libraries and outputs stay under ignored tmp/; real keys and model caches are not committed.

## Remaining scope

- Telemetry is published/logged. Application ingestion, receiver-offline state, high-value history/dashboard and normalization of local/AWS telemetry field names remain separate work.
- Physical debounce accuracy, simultaneous switches, FreeRTOS/Serial timing, radio behavior, Wi-Fi recovery, heap limits and 72-hour operation need hardware checks.
- RAM outbox data is lost on power failure; full buffers count drops. There is no persistent outbox.
- Local demo broker is plain MQTT on a trusted LAN; test commands must stay disabled for normal shelf operation. Passwords previously committed as literals should be rotated outside this repository.
- Actual Laya decision quality remains unestablished; confidence policy continues routing uncertain results to staff.

## Merge verification result

All required software checks passed before publishing:

- Local and AWS runtime sketches both compiled with the supplied secrets.h template, Arduino ESP32 core3.3.12, NimBLE-Arduino2.5.1 and PubSubClient2.8.0. Local image:1,299,884/1,310,720bytes (99% of default application partition); static globals60,572bytes. AWS image:931,021bytes (71%); static globals47,864bytes. Static sizes are not measured runtime heap usage. Local flash headroom is small; reevaluate the partition/features before enlarging the sketch.
- Node tests33/33; native protocol and switch programs passed.
- Actual hardware-PR local broker with HV01 and empty-timestamp payloads passed19integrationchecks using real Laya. The production IoT bridge path also passed19checks after correcting its35-second deadline.
- Re-review of standards and spec found no remaining cart-event protocol blocker. Telemetry application integration and physical/AWS verification remain explicitly outside this merge's proof.

Reproduce the two transport paths with npm run verify:hardware and npm run verify:full-flow. Reports stay in ignored data/ with unique run state/logs and per-run report.json; firmware build products stay in tmp/.

Native checks (a C++17 compiler must be on PATH):

```powershell
g++ -std=c++17 -I tests/firmware tests/firmware/protocol_test.cpp -o tmp/protocol-test.exe
./tmp/protocol-test.exe
g++ -std=c++17 -I tests/firmware tests/firmware/limit_switch_test.cpp -o tmp/limit-switch-test.exe
./tmp/limit-switch-test.exe
```
