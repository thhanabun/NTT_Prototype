# Basketly Local MQTT Broker & HTTP Bridge

A lightweight local MQTT Broker (powered by [Aedes](https://github.com/moscajs/aedes)) designed for local hardware testing of the ESP32 smart shelf (`SHELF-01`).

---

## Features

- **Zero TLS/Cert Overhead**: Listens on standard TCP port `1883` for non-TLS local development.
- **Auto HTTP Forwarding**: Listens to shelf events on `smartbasket/shelf/+/events` and automatically forwards them via HTTP POST to the local prototype server (`http://127.0.0.1:3000/api/events`).
- **Telemetry Monitor**: Displays 1 Hz shelf telemetry and beacon RSSI logs in the console.

---

## How to Run

### 1. Install Dependencies (First time only)

```powershell
cd tools/mqtt-broker
npm install
cd ../..
```

### 2. Start the Broker

From the repository root:

```powershell
npm run broker
```

Or directly:

```powershell
node tools/mqtt-broker/broker.mjs
```

---

## Expected ESP32 Topics

- **Events**: `smartbasket/shelf/SHELF-01/events`
  - Fired on switch state changes (`PICK` / `PUT_BACK`).
- **Telemetry**: `smartbasket/shelf/SHELF-01/telemetry`
  - Published periodically (1 Hz) containing switch states and BLE beacon RSSI medians.

## Application delivery protocol

Only exact smartbasket/shelf/{shelfId}/events topics are forwarded. After the API returns 2xx, publish the eventId as the plain body on smartbasket/shelf/{shelfId}/acks (QoS 1). Invalid JSON, non-2xx and network errors are logged without an ACK; firmware keeps the event and retries. HTTP timeout is 35 seconds to accommodate the local model's 30-second deadline. MQTT_PORT can override port1883.

Use one forwarder: leave FORWARD_TO_HTTP=true for this local broker, or disable it and run the separate IoT bridge. Running both consumers needlessly duplicates ingestion (the backend still deduplicates by eventId). Telemetry is logged and forwarded to /api/telemetry for the Agent evidence history. It does not emit a shelf-event ACK.

This broker binds on the LAN for hardware development without TLS/authentication. Keep it on a trusted demo network; do not expose it as a public production broker. Real AWS uses a separate TLS/certificate connection.
