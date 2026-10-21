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
