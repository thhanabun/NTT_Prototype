import { createServer } from 'node:net';
import { Aedes } from 'aedes';
import http from 'node:http';

const PORT = 1883;
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

// Forward shelf event to local web prototype server
function forwardToLocalServer(payloadStr) {
  if (!FORWARD_TO_HTTP) return;
  try {
    const payload = JSON.parse(payloadStr);
    const data = JSON.stringify(payload);
    const url = new URL(HTTP_API_URL);

    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 2000,
    }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`\x1b[36m[HTTP Bridge]\x1b[0m Event forwarded to ${HTTP_API_URL} (Status ${res.statusCode})`);
      }
    });

    req.on('error', () => {
      // Prototype server may not be running, ignore quietly
    });

    req.write(data);
    req.end();
  } catch (err) {
    // Not valid JSON or ignore
  }
}

// Published messages
aedes.on('publish', (packet, client) => {
  if (!packet.topic.startsWith('$SYS/')) {
    const topic = packet.topic;
    const payloadStr = packet.payload.toString('utf8');
    const clientName = client ? client.id : 'internal';

    if (topic.includes('/events')) {
      console.log('\n==================================================================');
      console.log(`\x1b[35m[MQTT EVENT]\x1b[0m From: ${clientName} | Topic: \x1b[33m${topic}\x1b[0m`);
      console.log(`Payload: ${payloadStr}`);
      console.log('==================================================================');
      forwardToLocalServer(payloadStr);
    } else if (topic.includes('/telemetry')) {
      process.stdout.write(`\x1b[90m[MQTT Telemetry] ${topic}: ${payloadStr}\x1b[0m\n`);
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
