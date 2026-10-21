import test from "node:test";
import assert from "node:assert/strict";
import { forwardShelfEvent } from "../tools/mqtt-broker/forward-event.mjs";

test("Hardware broker ACK follows successful API ingestion; retries preserve ID/delayed evidence", async () => {
  const steps = [];
  const payload = Buffer.from(JSON.stringify({ eventId: "esp32-12345678-1", delayed: true, rssi: { A: -51, B: -72, HV01: -48 } }));
  assert.equal(await forwardShelfEvent(payload, {
    apiOrigin: "http://local.test/api/events",
    fetchImpl: async (url, request) => {
      assert.equal(url.href, "http://local.test/api/events");
      assert.equal(JSON.parse(request.body).rssi.HV01, -48);
      assert.equal(JSON.parse(request.body).delayed, true);
      steps.push("ingest"); return { ok: true };
    },
    publishAck: async (id) => { steps.push(id); },
  }), true);
  assert.deepEqual(steps, ["ingest", "esp32-12345678-1"]);
});

test("Hardware broker rejects malformed or failed ingestion without acknowledging", async () => {
  let calls = 0;
  let acks = 0;
  const options = {
    apiOrigin: "http://local.test", log: () => {},
    fetchImpl: async () => { calls++; return { ok: false, status: 503 }; },
    publishAck: async () => { acks++; },
  };
  assert.equal(await forwardShelfEvent(Buffer.from("bad JSON"), options), false);
  assert.equal(await forwardShelfEvent(Buffer.from("{}"), options), false);
  assert.equal(calls, 0);
  assert.equal(await forwardShelfEvent(Buffer.from('{"eventId":"one"}'), options), false);
  assert.equal(calls, 1);
  assert.equal(acks, 0);
});
