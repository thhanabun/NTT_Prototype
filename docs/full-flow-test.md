# Local signal-to-resolution integration check

Run from the codex/fsm-iotcore checkout. Start the real model in one terminal:

```powershell
npm run model:laya
```

In a second terminal:

```powershell
npm run verify:full-flow
npm run verify:hardware
npm test
```

The default integration script uses Aedes as a test-only MQTT 3.1.1 broker listening on a random loopback TCP port. An MQTT hardware simulator sends the firmware's event shape and subscribes to the firmware's application-ACK topic. It starts the production IoT bridge and an isolated real HTTP app with Laya enabled. verify:hardware instead starts the hardware PR's actual tools/mqtt-broker/broker.mjs with its HTTP forwarder. Both paths use the same ingestion/ACK helper. Neither resets the normal demo DB.

```text
Scripted switch/BLE event (same payload as firmware)
  -> MQTT publisher, QoS 0/1
  -> local TCP MQTT broker
  -> production IoT bridge
  -> real HTTP compute/application
  -> deterministic FSM
       clear: cart update without model
       ambiguous: evidence tools -> actual Laya HTTP -> policy -> pending case
       missing/delayed/conflict: staff case without model
  -> scripted human HTTP decision -> cart validation -> case closure
  -> persistent JSON state, case timeline, audit, structured logs
  -> two real SSE subscribers representing shopper/staff
  -> MQTT application ACK only after successful HTTP ingestion
```

## Assertions

- Thirty PICK/PUT_BACK cycles alternate A/B and Coke/Water. Thirty duplicate, delayed-flag retries are added. Every quantity and total is checked; clear signals make zero model requests.
- Ambiguous A/B and tied evidence call real Laya and all three evidence tools. Pending cases cannot add payable value. Checkout and duplicate human decisions are rejected. Both SSE streams receive RUNNING and COMPLETED agent states.
- An ambiguous PUT_BACK decreases an existing quantity only after staff approval.
- Missing tag evidence, delayed signals, missing sessions and empty-cart PUT_BACK route to staff. No speculative basket/cart assignment is made.
- A deliberately injected HTTP 503 records a failed Laya invocation and staff routing without using a mock recommendation.
- A real model response is delayed 6.5 seconds. A device retry after 3 seconds invokes no extra inference, and staff cannot approve while the investigation is running.
- A deliberately stalled model endpoint exercises the real 30-second client timeout. Both forwarders wait up to 35 seconds; the persisted failed-model/staff case can be acknowledged after successful ingestion, and retry causes no extra inference or charge.
- Invalid JSON and SKU/lane mismatch receive no application ACK and do not change the DB.
- The MQTT device disconnects, reconnects and retries an already ingested event; totals remain unchanged.
- The HTTP application restarts from disk and its state matches exactly. A new SSE connection gets the saved state.
- Mock checkout uses the confirmed total and closes the session. Later hardware events for that basket require staff review.
- A separate real local repository runs the cloud handler code: FSM creation, case-manager Lambda with actual Laya, all four read-only action-group tools, human resolution, validator Lambda, audit-writer Lambda and disk reload. The DynamoDB read boundary of the action-group Lambda is an explicit fixture; AWS is not contacted.
- Structured application logs and durable audit actions are asserted, including device, FSM, tools, model failures, human decisions, cart validation, duplicates and checkout.

## Outputs

- data/full-flow-report.json: machine-readable assertions, model responses, signal-to-ACK/first-SSE timings, stream counts and limitations.
- data/full-flow-<unique>/report.json: the same report preserved for that run, so a later transport-path check does not overwrite its evidence.
- data/full-flow-<unique>/state.json: isolated HTTP application DB.
- data/full-flow-<unique>/lambda-state.json: isolated Lambda-handler test DB.
- application.log and bridge.log in the same run directory.

The script stops its app, proxy, broker and MQTT clients after the run. It leaves the independently started model service running. Run data is ignored by Git and preserved for inspection.

## Coverage boundaries and outstanding work

These checks exercise local compute and source handler code, not managed AWS infrastructure. There is no claim that IoT Core certificates/policies, Lambda packaging/IAM, Step Functions callback wiring, Bedrock orchestration, or live DynamoDB were exercised. The hosted IoT-to-event-processor Lambda path and customer/staff handoff callbacks still require implementation/deployment integration; the current executable transport uses the MQTT-to-HTTP bridge.

SSE is the current local realtime transport. Two network subscribers are checked; browser rendering, camera/QR interaction and visual layout are not covered by this command.

Real Laya scores in the sample keep ambiguous cases in staff review. The real-model integration must not manufacture high confidence to force the Customer Confirm branch. Customer YES and NO paths are covered by separate deterministic policy fixtures in npm test; they are not real-model acceptance claims. Local automatic customer-response deadline escalation is not implemented; the future Step Functions definition contains a customer timeout route, but its execution and callbacks are unverified.

The simulator starts at the firmware event boundary. Physical switch debounce, BLE scanning/RSSI filtering, ESP32 outbox capacity, offline detection and real Wi-Fi loss need device tests. Software transport cycles are not physical detection-accuracy measurements. Model recommendation quality and the end-to-end physical latency target also remain unestablished.

## Bug found during this check

An in-flight investigation previously allowed staff approval, and late completion could reopen a human-closed case. Human resolution is now rejected while the agent is RUNNING; closed cases cannot be re-investigated or overwritten by a late completion. A regression test checks the running/retry/closed-failure sequence.
