import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPresenceForwarder, forwardShelfEvent } from "../tools/mqtt-broker/forward-event.mjs";

test("AWS device policy permits the hardware events/telemetry topics and only its own client", () => {
  const policy = JSON.parse(readFileSync(new URL("../infra/aws-iot/policies/device.json", import.meta.url)));
  const connect = policy.Statement.find((item) => item.Action === "iot:Connect");
  assert.equal(connect.Resource, "arn:aws:iot:REGION:ACCOUNT_ID:client/SHELF-01");
  const publish = policy.Statement.find((item) => item.Action === "iot:Publish");
  assert.deepEqual(publish.Resource, [
    "arn:aws:iot:REGION:ACCOUNT_ID:topic/smartbasket/shelf/SHELF-01/events",
    "arn:aws:iot:REGION:ACCOUNT_ID:topic/smartbasket/shelf/SHELF-01/telemetry",
  ]);
});

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

test("Presence forwarder posts to /api/presence and keeps only the latest report per shelf", async () => {
  const sent = [];
  const pending = [];
  const forward = createPresenceForwarder({
    apiOrigin: "http://local.test/api/events", log: () => {},
    fetchImpl: (url, request) => {
      sent.push({ url: url.href, seq: JSON.parse(request.body).seq });
      return new Promise((resolve) => pending.push(() => resolve({ ok: true })));
    },
  });
  const report = (seq, shelfId = "SHELF-01") => Buffer.from(JSON.stringify({ shelfId, seq, rssi: { A: -60, B: null } }));
  assert.equal(forward(report(1)), true);
  forward(report(2));
  forward(report(3));
  forward(report(1, "SHELF-02"));
  assert.deepEqual(sent.map((item) => item.seq), [1, 1]);
  assert.equal(sent[0].url, "http://local.test/api/presence");
  pending.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent.map((item) => item.seq), [1, 1, 3]);
});

test("Presence forwarder drops malformed reports and survives server errors", async () => {
  let calls = 0;
  const logs = [];
  const forward = createPresenceForwarder({
    apiOrigin: "http://local.test", log: (line) => logs.push(line),
    fetchImpl: async () => { calls++; return { ok: false, status: 503 }; },
  });
  assert.equal(forward(Buffer.from("bad JSON")), false);
  assert.equal(forward(Buffer.from('{"rssi":{}}')), false);
  assert.equal(calls, 0);
  forward(Buffer.from('{"shelfId":"SHELF-01"}'));
  await new Promise((resolve) => setImmediate(resolve));
  forward(Buffer.from('{"shelfId":"SHELF-01"}'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(logs.length, 1); // one log per failure streak
});
