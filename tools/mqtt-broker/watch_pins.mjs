import mqtt from 'mqtt';
import fs from 'node:fs';

const logFile = 'c:/KMUTT/Competition/NTTDATA/NTT_Prototype/tmp/pin_activity.log';
fs.writeFileSync(logFile, `=== Pin Watcher Started at ${new Date().toISOString()} ===\n`);

const client = mqtt.connect('mqtt://127.0.0.1:1883');
client.on('connect', () => {
  client.subscribe(['smartbasket/shelf/+/telemetry', 'smartbasket/shelf/+/events']);
});

let lastGnd = '[]';
let lastRaw0 = 1;
let lastRaw1 = 1;

client.on('message', (topic, payload) => {
  const line = `[${new Date().toLocaleTimeString()}] [${topic}]: ${payload.toString()}\n`;
  if (topic.includes('/events')) {
    fs.appendFileSync(logFile, `*** EVENT ***: ${line}`);
    console.log(line);
  } else {
    try {
      const data = JSON.parse(payload.toString());
      const gndStr = JSON.stringify(data.gndPins || []);
      const r0 = data.lanes?.[0]?.raw;
      const r1 = data.lanes?.[1]?.raw;
      if (gndStr !== lastGnd || r0 !== lastRaw0 || r1 !== lastRaw1) {
        fs.appendFileSync(logFile, `PIN CHANGE: ${line}`);
        console.log(`PIN CHANGE: gndPins=${gndStr}, raw0=${r0}, raw1=${r1}`);
        lastGnd = gndStr;
        lastRaw0 = r0;
        lastRaw1 = r1;
      }
    } catch(e) {}
  }
});
