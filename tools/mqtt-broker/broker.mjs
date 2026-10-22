import { createServer } from 'node:net';
import { Aedes } from 'aedes';
import { forwardShelfEvent, forwardTelemetry } from './forward-event.mjs';

const PORT = Number(process.env.MQTT_PORT || 1883);
const HOST = '0.0.0.0';
const FORWARD_TO_HTTP = process.env.FORWARD_TO_HTTP !== 'false';
const HTTP_API_URL = process.env.HTTP_API_URL || 'http://127.0.0.1:3000/api/events';

const aedes = new Aedes({
  maxClientsIdLength: 100,
});
await aedes.listen();
const server = createServer(aedes.handle);

// Client connection events
aedes.on('client', (client) => {
  console.log(`\x1b[32m[MQTT Broker] Client Connected:\x1b[0m ${client ? client.id : 'unknown'}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`\x1b[33m[MQTT Broker] Client Disconnected:\x1b[0m ${client ? client.id : 'unknown'}`);
});

// Published messages
aedes.on('publish', (packet, client) => {
  if (!packet.topic.startsWith('$SYS/')) {
    const topic = packet.topic;
    const payloadStr = packet.payload.toString('utf8');
    const clientName = client ? client.id : 'internal';

    const shelfEvent = /^smartbasket\/shelf\/([A-Z0-9-]+)\/events$/.exec(topic);
    if (client && shelfEvent) {
      console.log('\n==================================================================');
      console.log(`\x1b[35m[MQTT EVENT]\x1b[0m From: ${clientName} | Topic: \x1b[33m${topic}\x1b[0m`);
      console.log(`Payload: ${payloadStr}`);
      console.log('==================================================================');
      if (FORWARD_TO_HTTP) void forwardShelfEvent(packet.payload, {
        apiOrigin: HTTP_API_URL,
        publishAck: (id) => new Promise((resolve, reject) => {
          aedes.publish({ cmd: 'publish', topic: `smartbasket/shelf/${shelfEvent[1]}/acks`, payload: Buffer.from(id), qos: 1, retain: false }, (error) => error ? reject(error) : resolve());
        }),
      });
    } else if (client && /^smartbasket\/shelf\/([A-Z0-9-]+)\/telemetry$/.test(topic)) {
      process.stdout.write(`\x1b[90m[MQTT Telemetry] ${topic}: ${payloadStr}\x1b[0m\n`);
      if (FORWARD_TO_HTTP) void forwardTelemetry(packet.payload, { apiOrigin: HTTP_API_URL, shelfId: topic.split('/')[2] });
    } else {
      console.log(`[MQTT] [${topic}] ${payloadStr}`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('==================================================================');
  console.log(`  Basketly Local MQTT Broker running on \x1b[32m0.0.0.0:${PORT}\x1b[0m`);
  console.log(`  Listening for ESP32 topics:`);
  console.log(`    - Events    : smartbasket/shelf/+/events`);
  console.log(`    - Telemetry : smartbasket/shelf/+/telemetry`);
  console.log('==================================================================');
});
