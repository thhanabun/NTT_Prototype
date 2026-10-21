import test from "node:test";
import assert from "node:assert/strict";
import { forwardShelfEvent } from "../scripts/iot-bridge.mjs";

const payload = Buffer.from(JSON.stringify({
  eventId: "shelf-boot-1",
  shelfId: "SHELF-01",
  laneId: "LANE-1",
  eventType: "PICK",
  rssi: { A: -50, B: -72 },
}));

test("IoT bridge acknowledges only after local API ingestion succeeds", async () => {
  const acknowledgements = [];
  let posted;
  const result = await forwardShelfEvent(payload, {
    apiOrigin: "http://127.0.0.1:3000",
    fetchImpl: async (url, request) => {
      assert.equal(url.href, "http://127.0.0.1:3000/api/events");
      assert.equal(request.method, "POST");
      posted = JSON.parse(request.body);
      return { ok: true, status: 200 };
    },
    publishAck: async (eventId) => acknowledgements.push(eventId),
    log: () => {},
  });

  assert.equal(result, true);
  assert.equal(posted.eventId, "shelf-boot-1");
  assert.deepEqual(acknowledgements, ["shelf-boot-1"]);
});

test("IoT bridge leaves events unacknowledged when the local API rejects them", async () => {
  const acknowledgements = [];
  const result = await forwardShelfEvent(payload, {
    apiOrigin: "http://127.0.0.1:3000",
    fetchImpl: async () => ({ ok: false, status: 503 }),
    publishAck: async (eventId) => acknowledgements.push(eventId),
    log: () => {},
  });

  assert.equal(result, false);
  assert.deepEqual(acknowledgements, []);
});

test("IoT bridge rejects malformed messages before contacting the local API", async () => {
  let requests = 0;
  let acknowledgements = 0;
  const result = await forwardShelfEvent(Buffer.from("not-json"), {
    apiOrigin: "http://127.0.0.1:3000",
    fetchImpl: async () => { requests += 1; return { ok: true, status: 200 }; },
    publishAck: async () => { acknowledgements += 1; },
    log: () => {},
  });

  assert.equal(result, false);
  assert.equal(requests, 0);
  assert.equal(acknowledgements, 0);
});
