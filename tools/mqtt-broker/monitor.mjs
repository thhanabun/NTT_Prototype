import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://127.0.0.1:1883');

console.log('==================================================================');
console.log('       Basketly Live Switch & Proximity Monitor                   ');
console.log('==================================================================');

client.on('connect', () => {
  client.subscribe(['smartbasket/shelf/+/telemetry', 'smartbasket/shelf/+/events']);
  console.log('Listening to MQTT topics:\n  - smartbasket/shelf/+/telemetry\n  - smartbasket/shelf/+/events\n');
  console.log('Press Ctrl+C to exit.\n');
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString('utf8'));

    if (topic.includes('/events')) {
      console.log('\n******************************************************************');
      console.log(`\x1b[1;32m>>> [EVENT TRIGGERED] ${data.laneId} (${data.sku}): ${data.eventType} <<<\x1b[0m`);
      console.log(`Event ID : ${data.eventId}`);
      console.log(`RSSI     : Basket A=${data.rssi?.A ?? 'null'} dBm | Basket B=${data.rssi?.B ?? 'null'} dBm | HV01=${data.rssi?.HV01 ?? 'null'} dBm`);
      console.log('******************************************************************\n');
    } else if (topic.includes('/telemetry') && data.lanes) {
      const l1 = data.lanes.find((l) => l.laneId === 'LANE-1') || {};
      const l2 = data.lanes.find((l) => l.laneId === 'LANE-2') || {};

      const l1Status = l1.present ? '\x1b[32m[PRESENT]\x1b[0m' : '\x1b[31m[EMPTY]\x1b[0m';
      const l2Status = l2.present ? '\x1b[32m[PRESENT]\x1b[0m' : '\x1b[31m[EMPTY]\x1b[0m';

      const l1Raw = l1.raw === 0 ? '\x1b[32m0 (GND/Pressed)\x1b[0m' : '\x1b[33m1 (3.3V/Open)\x1b[0m';
      const l2Raw = l2.raw === 0 ? '\x1b[32m0 (GND/Pressed)\x1b[0m' : '\x1b[33m1 (3.3V/Open)\x1b[0m';

      process.stdout.write(
        `\r[Uptime ${Math.floor(data.uptimeMs / 1000)}s] ` +
        `Coke (P26): ${l1Status} raw=${l1Raw} | ` +
        `Water (P27): ${l2Status} raw=${l2Raw} | ` +
        `Beacon A: ${data.rssi?.A ?? '-'} dBm   `
      );
    }
  } catch (e) {
    // ignore
  }
});
