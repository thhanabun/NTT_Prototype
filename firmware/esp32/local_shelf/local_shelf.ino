#include <Arduino.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <cmath>

enum BeaconRole {
  ROLE_BASKET_A = 0,
  ROLE_BASKET_B = 1,
  ROLE_EXPENSIVE_ITEM = 2,
  ROLE_COUNT = 3
};

struct Lane {
  uint8_t pin;
  const char* laneId;
  const char* sku;
  bool stablePresent;
  bool candidatePresent;
  uint32_t candidateSince;
};

// ============================================================================
// Basketly — Main Smart Shelf Firmware (Local MQTT & USB Serial Testing)
// File: firmware/esp32/esp32.ino
// 
// Use this sketch for:
//   1. Local testing with USB Serial Monitor.
//   2. Local MQTT publishing (Port 1883, non-TLS) to your local broker / laptop.
//   3. Optional HTTP POST fallback to laptop prototype (/api/events).
//   For AWS IoT Core MQTT/TLS deployment, see: firmware/esp32/aws_shelf/aws_shelf.ino
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Secrets & Wi-Fi / Local MQTT Configuration
// ----------------------------------------------------------------------------
#if __has_include("../secrets.h")
  #include "../secrets.h"
#elif __has_include("secrets.h")
  #include "secrets.h"
#else
  #include "../secrets.example.h"
#endif
#include "../shelf_protocol.h"
#ifndef SHELF_PROJECT_UUID
  #define SHELF_PROJECT_UUID ""
#endif
#ifndef SHELF_ENABLE_TEST_COMMANDS
  #define SHELF_ENABLE_TEST_COMMANDS 0
#endif
#ifndef SHELF_ID_VALUE
  #define SHELF_ID_VALUE "SHELF-01"
#endif
#ifndef SHELF_SWITCH_COKE_GPIO
  #define SHELF_SWITCH_COKE_GPIO 26
#endif
#ifndef SHELF_SWITCH_WATER_GPIO
  #define SHELF_SWITCH_WATER_GPIO 27
#endif


// Target MAC String references for auto-normalizing comparison
String targetBasketAMac       = BASKET_A_MAC;
String targetBasketBMac       = BASKET_B_MAC;
String targetExpensiveItemMac = EXPENSIVE_ITEM_MAC;

// Enable Local MQTT and/or HTTP
bool ENABLE_LOCAL_MQTT = true;
bool ENABLE_LOCAL_HTTP = false;
const char* LOCAL_HTTP_HOST = LOCAL_SERVER_HOST;
const uint16_t LOCAL_HTTP_PORT = LOCAL_SERVER_PORT;

// MQTT Topics matching AWS IoT schema
constexpr char TOPIC_EVENTS[]    = "smartbasket/shelf/" SHELF_ID_VALUE "/events";
constexpr char TOPIC_TELEMETRY[] = "smartbasket/shelf/" SHELF_ID_VALUE "/telemetry";
constexpr char TOPIC_COMMAND[]   = "smartbasket/shelf/" SHELF_ID_VALUE "/cmd";

// ----------------------------------------------------------------------------
// 2. Hardware Microswitch Pins (Roller switches: COM -> GND, NO -> GPIO pin)
// ----------------------------------------------------------------------------
constexpr uint8_t COKE_SWITCH_PIN     = SHELF_SWITCH_COKE_GPIO; // Lane 1: Coca-Cola
constexpr uint8_t WATER_SWITCH_PIN    = SHELF_SWITCH_WATER_GPIO; // Lane 2: Mineral Water
constexpr uint32_t SWITCH_DEBOUNCE_MS = 80; // Stable transition; calibrate against physical switch bounce

// Hardware interrupt counters (captures ANY electrical change, even for 1 microsecond)
volatile uint32_t cokeEdgeCount = 0;
volatile uint32_t waterEdgeCount = 0;

void IRAM_ATTR isrCoke() {
  cokeEdgeCount++;
}

void IRAM_ATTR isrWater() {
  waterEdgeCount++;
}

// Candidate GPIO probe list to detect accidental wrong pin insertion
#if defined(SHELF_BOARD_IS_ESP32S3)
constexpr uint8_t PROBE_PINS[] = {COKE_SWITCH_PIN, WATER_SWITCH_PIN};
#else
constexpr uint8_t PROBE_PINS[] = {25, 26, 27, 14, 13, 32, 33, 4, 18, 19, 21, 22, 23};
#endif

// ----------------------------------------------------------------------------
// 3. BLE Beacons Configuration (3 Tags: Basket A, Basket B, Expensive Product)
// ----------------------------------------------------------------------------
// Standard iBeacon Major / Minor identities (docs/iot-roadmap.md)
constexpr uint16_t BASKET_A_MAJOR       = 1;
constexpr uint16_t BASKET_A_MINOR       = 1;
constexpr uint16_t BASKET_B_MAJOR       = 1;
constexpr uint16_t BASKET_B_MINOR       = 2;
constexpr uint16_t EXPENSIVE_ITEM_MAJOR = 1;
constexpr uint16_t EXPENSIVE_ITEM_MINOR = 3;

constexpr char SHELF_ID[]          = SHELF_ID_VALUE;
constexpr char EXPENSIVE_ITEM_ID[] = "HV-001";
constexpr uint32_t TAG_FRESH_MS    = 5000; // 5000 ms freshness window
constexpr size_t RSSI_WINDOW       = 5;    // 5-sample rolling median
constexpr int CLEAR_MARGIN_DB      = 10;   // 10 dB clear lead threshold

// ----------------------------------------------------------------------------
// 4. Data Types & State
// ----------------------------------------------------------------------------
struct TrackedBeacon {
  const char* label;
  String targetMac;
  uint16_t targetMajor;
  uint16_t targetMinor;
  String detectedMac;
  int8_t lastRssi;
  int8_t rssiHistory[RSSI_WINDOW];
  uint8_t rssiCount;
  uint8_t rssiHead;
  uint32_t lastSeenMs;
  int8_t txPower;
  uint32_t packetsCount;
  uint32_t rssiAt[RSSI_WINDOW] = {};
};

TrackedBeacon trackedBeacons[ROLE_COUNT] = {
  {"Basket A",       targetBasketAMac,       BASKET_A_MAJOR,       BASKET_A_MINOR,       "", 0, {}, 0, 0, 0, -59, 0},
  {"Basket B",       targetBasketBMac,       BASKET_B_MAJOR,       BASKET_B_MINOR,       "", 0, {}, 0, 0, 0, -59, 0},
  {"Expensive Item", targetExpensiveItemMac, EXPENSIVE_ITEM_MAJOR, EXPENSIVE_ITEM_MINOR, "", 0, {}, 0, 0, 0, -59, 0}
};

Lane lanes[] = {
  {COKE_SWITCH_PIN,  "LANE-1", "COKE",  false, false, 0},
  {WATER_SWITCH_PIN, "LANE-2", "WATER", false, false, 0}
};

portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;
WiFiMulti wifiMulti;
WiFiClient tcpClient;
PubSubClient mqttClient(tcpClient);
NimBLEScan* pBLEScan = nullptr;

uint32_t eventSeq = 0;
uint32_t bootId = 0;
uint32_t lastDashboardMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastMqttRetryMs = 0;
uint32_t lastWifiRetryMs = 0;
bool wasWifiConnected = false;
ShelfOutbox eventOutbox;
bool ackSubscribed = false;
constexpr char TOPIC_ACKS[] = "smartbasket/shelf/" SHELF_ID_VALUE "/acks";

// ----------------------------------------------------------------------------
// 5. Signal Filtering & Proximity Helpers
// ----------------------------------------------------------------------------
bool decodeIBeacon(const uint8_t* data, size_t len, uint16_t& major, uint16_t& minor, int8_t& txPower) {
  if (len < 25) return false;
  if (data[0] != 0x4C || data[1] != 0x00 || data[2] != 0x02 || data[3] != 0x15) return false;
  major = (static_cast<uint16_t>(data[20]) << 8) | data[21];
  minor = (static_cast<uint16_t>(data[22]) << 8) | data[23];
  txPower = static_cast<int8_t>(data[24]);
  return true;
}

int8_t getMedianRssi(BeaconRole role, bool& isFresh) {
  int8_t values[RSSI_WINDOW];
  uint32_t times[RSSI_WINDOW];
  uint8_t count;
  portENTER_CRITICAL(&bleMux);
  const auto& beacon = trackedBeacons[role];
  count = beacon.rssiCount;
  memcpy(values, beacon.rssiHistory, sizeof(values));
  memcpy(times, beacon.rssiAt, sizeof(times));
  portEXIT_CRITICAL(&bleMux);
  return shelfFreshMedian(values, times, count, millis(), isFresh);
}

float estimateDistanceM(int8_t rssi, int8_t txPower) {
  if (rssi == 0) return -1.0f;
  const int8_t power = (txPower != 0) ? txPower : -59;
  const float ratio = static_cast<float>(power - rssi) / (10.0f * 2.2f);
  return pow(10.0f, ratio);
}

const char* getExpensiveStatus() {
  uint32_t lastSeen = 0;
  portENTER_CRITICAL(&bleMux);
  lastSeen = trackedBeacons[ROLE_EXPENSIVE_ITEM].lastSeenMs;
  portEXIT_CRITICAL(&bleMux);

  if (trackedBeacons[ROLE_EXPENSIVE_ITEM].rssiCount == 0) return "NOT_YET_SEEN";
  if ((millis() - lastSeen) <= TAG_FRESH_MS) return "RECENTLY_SEEN";
  return "STALE";
}

String getSignalBar(int8_t rssi) {
  if (rssi == 0) return "[----------]";
  int level = map(constrain(static_cast<int>(rssi), -90, -40), -90, -40, 1, 10);
  String bar = "[";
  for (int i = 0; i < 10; ++i) bar += (i < level) ? "#" : "-";
  bar += "]";
  return bar;
}

// ----------------------------------------------------------------------------
// 6. NimBLE Scan Callback
// ----------------------------------------------------------------------------
class LocalScanCallbacks final : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) override {
    String mac = device->getAddress().toString().c_str();
    mac.toLowerCase();
    const int8_t rssi = device->getRSSI();

    bool isIBeacon = false;
    uint16_t major = 0;
    uint16_t minor = 0;
    int8_t txPower = -59;

    if (device->haveManufacturerData()) {
      std::string mfg = device->getManufacturerData();
      isIBeacon = shelfBeaconUuidMatches(reinterpret_cast<const uint8_t*>(mfg.data()), mfg.length(), SHELF_PROJECT_UUID) &&
        decodeIBeacon(reinterpret_cast<const uint8_t*>(mfg.data()), mfg.length(),
                                major, minor, txPower);
    }

    int matchedRole = -1;
    String cleanMac = mac;
    cleanMac.replace(":", "");
    cleanMac.replace("-", "");
    cleanMac.toLowerCase();

    for (int r = 0; r < ROLE_COUNT; ++r) {
      String target = trackedBeacons[r].targetMac;
      target.replace(":", "");
      target.replace("-", "");
      target.toLowerCase();
      if (target.length() > 0 && target == cleanMac) {
        matchedRole = r;
        break;
      }
    }

    if (matchedRole < 0 && isIBeacon) {
      for (int r = 0; r < ROLE_COUNT; ++r) {
        if (trackedBeacons[r].targetMac.length() == 0 && trackedBeacons[r].targetMajor == major && trackedBeacons[r].targetMinor == minor) {
          matchedRole = r;
          break;
        }
      }
    }

    if (matchedRole < 0) return;

    portENTER_CRITICAL(&bleMux);
    TrackedBeacon& b = trackedBeacons[matchedRole];
    b.detectedMac = mac;
    b.lastRssi = rssi;
    b.txPower = txPower;
    b.rssiHistory[b.rssiHead] = rssi;
    b.rssiAt[b.rssiHead] = millis();
    b.rssiHead = (b.rssiHead + 1) % RSSI_WINDOW;
    if (b.rssiCount < RSSI_WINDOW) ++b.rssiCount;
    b.lastSeenMs = millis();
    b.packetsCount++;
    portEXIT_CRITICAL(&bleMux);
  }
};

LocalScanCallbacks scanCallbacks;

// ----------------------------------------------------------------------------
// 7. Non-blocking Wi-Fi & MQTT Connection & Telemetry
// ----------------------------------------------------------------------------
void maintainWifi() {
  const uint8_t status = wifiMulti.run();
  const bool isConnected = (status == WL_CONNECTED);

  if (isConnected && !wasWifiConnected) {
    wasWifiConnected = true;
    Serial.println("\n--------------------------------------------------");
    Serial.printf("[Wi-Fi] Connected to '%s'! IP: %s | RSSI: %d dBm\n",
                  WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
    Serial.println("--------------------------------------------------");
  } else if (!isConnected && wasWifiConnected) {
    wasWifiConnected = false;
    Serial.println("[Wi-Fi] Connection lost. Searching for Wi-Fi...");
  }
}

void maintainMqtt() {
  if (!ENABLE_LOCAL_MQTT || WiFi.status() != WL_CONNECTED) {
    ackSubscribed = false;
    eventOutbox.setReady(false);
    return;
  }

  if (mqttClient.connected()) {
    eventOutbox.setReady(ackSubscribed);
    mqttClient.loop();
    return;
  }

  eventOutbox.setReady(false);
  ackSubscribed = false;
  const uint32_t now = millis();
  if (now - lastMqttRetryMs < 5000) return; // Retry every 5s without blocking
  lastMqttRetryMs = now;

  char clientId[32];
  snprintf(clientId, sizeof(clientId), "%s-%04x", SHELF_ID, bootId);

  Serial.printf("[MQTT] Connecting to %s:%u (client: %s)...\n",
                LOCAL_MQTT_HOST, LOCAL_MQTT_PORT, clientId);

  if (mqttClient.connect(clientId)) {
    Serial.println("\x1b[32m[MQTT] >>> CONNECTED TO LOCAL BROKER! <<<\x1b[0m");
    ackSubscribed = mqttClient.subscribe(TOPIC_ACKS, 1);
    if (!ackSubscribed) { mqttClient.disconnect(); return; }
    eventOutbox.setReady(true);
    if (SHELF_ENABLE_TEST_COMMANDS) mqttClient.subscribe(TOPIC_COMMAND);
    // Publish online birth announcement
    char birthPayload[128];
    snprintf(birthPayload, sizeof(birthPayload),
             "{\"shelfId\":\"%s\",\"status\":\"ONLINE\",\"bootId\":\"%04x\"}",
             SHELF_ID, bootId);
    mqttClient.publish(TOPIC_TELEMETRY, birthPayload);
  } else {
    Serial.printf("[MQTT] Connect failed (rc=%d), retry in 5s\n", mqttClient.state());
  }
}

void publishTelemetry() {
  if (!ENABLE_LOCAL_MQTT || !mqttClient.connected()) return;

  bool freshA = false, freshB = false, freshExp = false;
  const int8_t rssiA = getMedianRssi(ROLE_BASKET_A, freshA);
  const int8_t rssiB = getMedianRssi(ROLE_BASKET_B, freshB);
  const int8_t rssiExp = getMedianRssi(ROLE_EXPENSIVE_ITEM, freshExp);

  const int raw0 = digitalRead(lanes[0].pin);
  const int raw1 = digitalRead(lanes[1].pin);

  // Scan all probe pins to see if any are pulled to GND
  char gndBuf[64] = "[]";
  String gndList = "";
  for (uint8_t p : PROBE_PINS) {
    if (digitalRead(p) == LOW) {
      if (gndList.length() > 0) gndList += ",";
      gndList += String(p);
    }
  }
  snprintf(gndBuf, sizeof(gndBuf), "[%s]", gndList.c_str());

  uint32_t hvLastSeen;
  portENTER_CRITICAL(&bleMux);
  hvLastSeen = trackedBeacons[ROLE_EXPENSIVE_ITEM].lastSeenMs;
  portEXIT_CRITICAL(&bleMux);
  const char* hvStatus = getExpensiveStatus();
  char hvAge[16] = "null";
  if (strcmp(hvStatus, "NOT_YET_SEEN") != 0) snprintf(hvAge, sizeof(hvAge), "%lu", static_cast<unsigned long>(millis() - hvLastSeen));
  char telem[768];
  snprintf(telem, sizeof(telem),
    "{\"shelfId\":\"%s\",\"uptimeMs\":%lu,"
    "\"lanes\":[{\"laneId\":\"%s\",\"sku\":\"%s\",\"present\":%s,\"raw\":%d},"
               "{\"laneId\":\"%s\",\"sku\":\"%s\",\"present\":%s,\"raw\":%d}],"
    "\"queueDepth\":%u,\"droppedEvents\":%lu,"
    "\"highValueItem\":{\"tagId\":\"HV-001\",\"status\":\"%s\",\"rssi\":%s,\"lastSeenMsAgo\":%s},"
    "\"gndPins\":%s,"
    "\"edges\":{\"coke\":%lu,\"water\":%lu},"
    "\"rssi\":{\"A\":%s,\"B\":%s,\"HV01\":%s}}",
    SHELF_ID, static_cast<unsigned long>(millis()),
    lanes[0].laneId, lanes[0].sku, lanes[0].stablePresent ? "true" : "false", raw0,
    lanes[1].laneId, lanes[1].sku, lanes[1].stablePresent ? "true" : "false", raw1,
    eventOutbox.depth(), static_cast<unsigned long>(eventOutbox.dropped()),
    hvStatus, freshExp ? String(rssiExp).c_str() : "null", hvAge,
    gndBuf,
    (unsigned long)cokeEdgeCount, (unsigned long)waterEdgeCount,
    freshA   ? String(rssiA).c_str()   : "null",
    freshB   ? String(rssiB).c_str()   : "null",
    freshExp ? String(rssiExp).c_str() : "null");

  mqttClient.publish(TOPIC_TELEMETRY, telem);
}

// ----------------------------------------------------------------------------
// 8. Event Dispatch (MQTT, Serial & Local HTTP)
// ----------------------------------------------------------------------------
bool postEventToLocalHttp(const char* jsonPayload) {
  if (!ENABLE_LOCAL_HTTP || WiFi.status() != WL_CONNECTED) return false;
  WiFiClient httpSocket; // Never reuse the MQTT TCP socket for HTTP.
  HTTPClient http;
  char url[128];
  snprintf(url, sizeof(url), "http://%s:%u/api/events", LOCAL_HTTP_HOST, LOCAL_HTTP_PORT);
  http.begin(httpSocket, url);
  http.setTimeout(35000);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(jsonPayload)), strlen(jsonPayload));
  http.end();
  return code >= 200 && code < 300;
}

void pumpEvents() {
  if (ENABLE_LOCAL_HTTP && WiFi.status() == WL_CONNECTED) eventOutbox.setReady(true);
  eventOutbox.pump(millis(), [](const char* id, const char* payload) {
    if (ENABLE_LOCAL_MQTT && mqttClient.connected() && ackSubscribed) return mqttClient.publish(TOPIC_EVENTS, payload);
    if (postEventToLocalHttp(payload)) { eventOutbox.acknowledge(id); return true; }
    return false;
  });
}

void triggerShelfEvent(const Lane& lane, const char* eventType) {
  bool freshA = false, freshB = false, freshExp = false;
  const int8_t rssiA = getMedianRssi(ROLE_BASKET_A, freshA);
  const int8_t rssiB = getMedianRssi(ROLE_BASKET_B, freshB);
  const int8_t rssiExp = getMedianRssi(ROLE_EXPENSIVE_ITEM, freshExp);

  int8_t txA = -59, txB = -59, txExp = -59;
  portENTER_CRITICAL(&bleMux);
  txA = trackedBeacons[ROLE_BASKET_A].txPower;
  txB = trackedBeacons[ROLE_BASKET_B].txPower;
  txExp = trackedBeacons[ROLE_EXPENSIVE_ITEM].txPower;
  portEXIT_CRITICAL(&bleMux);

  const float distA = freshA ? estimateDistanceM(rssiA, txA) : -1.0f;
  const float distB = freshB ? estimateDistanceM(rssiB, txB) : -1.0f;
  const float distExp = freshExp ? estimateDistanceM(rssiExp, txExp) : -1.0f;

  uint32_t nextSequence;
  portENTER_CRITICAL(&bleMux);
  nextSequence = ++eventSeq;
  portEXIT_CRITICAL(&bleMux);
  char eventId[40];
  snprintf(eventId, sizeof(eventId), "esp32-%04x-%04lu", bootId, static_cast<unsigned long>(nextSequence));

  // Build JSON payload conforming to schema
  char payload[384];
  snprintf(payload, sizeof(payload),
    "{\"eventId\":\"%s\",\"shelfId\":\"%s\",\"laneId\":\"%s\",\"sku\":\"%s\","
    "\"eventType\":\"%s\",\"delayed\":false,\"timestamp\":\"\","
    "\"rssi\":{\"A\":%s,\"B\":%s,\"HV01\":%s}}",
    eventId, SHELF_ID, lane.laneId, lane.sku, eventType,
    freshA   ? String(rssiA).c_str()   : "null",
    freshB   ? String(rssiB).c_str()   : "null",
    freshExp ? String(rssiExp).c_str() : "null");

  // Visual Event Banner on Serial Monitor
  Serial.println("\n******************************************************************");
  Serial.printf(">>> [EVENT TRIGGERED] %s (%s): %s <<<\n", lane.laneId, lane.sku, eventType);
  Serial.printf("  Event ID   : %s\n", eventId);
  Serial.printf("  Basket A   : %s dBm (%s) | ~%.2fm\n",
                freshA ? String(rssiA).c_str() : "null", freshA ? "FRESH" : "STALE", distA);
  Serial.printf("  Basket B   : %s dBm (%s) | ~%.2fm\n",
                freshB ? String(rssiB).c_str() : "null", freshB ? "FRESH" : "STALE", distB);

  if (freshA && freshB) {
    const int margin = abs(rssiA - rssiB);
    Serial.printf("  Lead Margin: %d dB (Decision: %s)\n",
                  margin, margin >= CLEAR_MARGIN_DB ? "CONFIRMED CLEAR LEAD (>=10 dB)" : "AMBIGUOUS (<10 dB)");
  }

  Serial.printf("  Expensive  : %s | Status: %s | RSSI: %s dBm | ~%.2fm\n",
                EXPENSIVE_ITEM_ID, getExpensiveStatus(),
                freshExp ? String(rssiExp).c_str() : "null", distExp);
  Serial.printf("  JSON       : %s\n", payload);
  Serial.println("******************************************************************");

  if (!eventOutbox.enqueue(eventId, payload, WiFi.status() == WL_CONNECTED)) {
    Serial.println("[OUTBOX] Full; event dropped (see droppedEvents)");
  }
}


void onMqttCommand(char* topic, byte* payload, unsigned int length) {
  if (length >= 64) return;
  char command[64] = {};
  memcpy(command, payload, length);
  if (strcmp(topic, TOPIC_ACKS) == 0) { eventOutbox.acknowledge(command); return; }
  if (!SHELF_ENABLE_TEST_COMMANDS || strcmp(topic, TOPIC_COMMAND) != 0) return;
  uint8_t lane;
  const char* type;
  if (shelfTestCommand(command, lane, type)) triggerShelfEvent(lanes[lane], type);
}


// ----------------------------------------------------------------------------
// 9. Switch Sampling (Active-Low Debounce)
// ----------------------------------------------------------------------------
void sampleLane(Lane& lane) {
  const int rawPin = digitalRead(lane.pin);
  const bool present = (rawPin == LOW);
  const uint32_t now = millis();

  if (present != lane.candidatePresent) {
    Serial.printf("[SWITCH] Pin %d (%s) raw level -> %d (%s)\n",
                  lane.pin, lane.laneId, rawPin, present ? "LOW/CLOSED" : "HIGH/OPEN");
    lane.candidatePresent = present;
    lane.candidateSince = now;
    return;
  }

  if (present == lane.stablePresent || (now - lane.candidateSince) < SWITCH_DEBOUNCE_MS) {
    return;
  }

  lane.stablePresent = present;
  triggerShelfEvent(lane, present ? "PUT_BACK" : "PICK");
}

// ----------------------------------------------------------------------------
// 10. Periodic Dashboard (every 2 seconds)
// ----------------------------------------------------------------------------
void printDashboard() {
  bool freshA = false, freshB = false, freshExp = false;
  const int8_t rssiA = getMedianRssi(ROLE_BASKET_A, freshA);
  const int8_t rssiB = getMedianRssi(ROLE_BASKET_B, freshB);
  const int8_t rssiExp = getMedianRssi(ROLE_EXPENSIVE_ITEM, freshExp);

  int8_t txA = -59, txB = -59, txExp = -59;
  String macA, macB, macExp;
  portENTER_CRITICAL(&bleMux);
  txA = trackedBeacons[ROLE_BASKET_A].txPower;
  txB = trackedBeacons[ROLE_BASKET_B].txPower;
  txExp = trackedBeacons[ROLE_EXPENSIVE_ITEM].txPower;
  macA = trackedBeacons[ROLE_BASKET_A].detectedMac;
  macB = trackedBeacons[ROLE_BASKET_B].detectedMac;
  macExp = trackedBeacons[ROLE_EXPENSIVE_ITEM].detectedMac;
  portEXIT_CRITICAL(&bleMux);

  const float distA = freshA ? estimateDistanceM(rssiA, txA) : -1.0f;
  const float distB = freshB ? estimateDistanceM(rssiB, txB) : -1.0f;
  const float distExp = freshExp ? estimateDistanceM(rssiExp, txExp) : -1.0f;

  Serial.println("\n==================================================================");
  Serial.printf(" [LOCAL MONITOR] Shelf: %s | Uptime: %lus\n",
                SHELF_ID, static_cast<unsigned long>(millis() / 1000));
  Serial.printf("  - Wi-Fi : %s\n",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "Connecting / Disconnected");
  Serial.printf("  - MQTT  : %s (%s:%u)\n",
                mqttClient.connected() ? "CONNECTED" : "Connecting / Reconnecting",
                LOCAL_MQTT_HOST, LOCAL_MQTT_PORT);
  Serial.println("------------------------------------------------------------------");
  Serial.println(" PHYSICAL SWITCHES:");
  Serial.printf("   - %s (%-5s) : [ %-7s ] (Pin %d | Raw Pin: %d [%s])\n",
                lanes[0].laneId, lanes[0].sku, lanes[0].stablePresent ? "PRESENT" : "EMPTY",
                lanes[0].pin, digitalRead(lanes[0].pin),
                digitalRead(lanes[0].pin) == LOW ? "GND / PRESSED" : "3.3V / OPEN");
  Serial.printf("   - %s (%-5s) : [ %-7s ] (Pin %d | Raw Pin: %d [%s])\n",
                lanes[1].laneId, lanes[1].sku, lanes[1].stablePresent ? "PRESENT" : "EMPTY",
                lanes[1].pin, digitalRead(lanes[1].pin),
                digitalRead(lanes[1].pin) == LOW ? "GND / PRESSED" : "3.3V / OPEN");

  Serial.println(" BLE BEACONS (3 Tags):");
  // Basket A
  Serial.printf("   1. Basket A (%s):\n", macA.length() > 0 ? macA.c_str() : trackedBeacons[ROLE_BASKET_A].targetMac.c_str());
  if (freshA) {
    Serial.printf("      RSSI: %s %d dBm | Dist: ~%.2fm\n", getSignalBar(rssiA).c_str(), rssiA, distA);
  } else {
    Serial.println("      RSSI: [NO SIGNAL / STALE]");
  }

  // Basket B
  Serial.printf("   2. Basket B (%s):\n", macB.length() > 0 ? macB.c_str() : trackedBeacons[ROLE_BASKET_B].targetMac.c_str());
  if (freshB) {
    Serial.printf("      RSSI: %s %d dBm | Dist: ~%.2fm\n", getSignalBar(rssiB).c_str(), rssiB, distB);
  } else {
    Serial.println("      RSSI: [NO SIGNAL / STALE]");
  }

  // Margin Check
  if (freshA && freshB) {
    const int margin = abs(rssiA - rssiB);
    Serial.printf("      >> Margin: %d dB | %s\n",
                  margin, margin >= CLEAR_MARGIN_DB ? "CLEAR LEAD (>=10 dB)" : "AMBIGUOUS (<10 dB)");
  }

  // Expensive Product
  Serial.printf("   3. Expensive Item - %s (%s):\n",
                EXPENSIVE_ITEM_ID, macExp.length() > 0 ? macExp.c_str() : trackedBeacons[ROLE_EXPENSIVE_ITEM].targetMac.c_str());
  Serial.printf("      Status: [ %s ]\n", getExpensiveStatus());
  if (freshExp) {
    Serial.printf("      RSSI: %s %d dBm | Dist: ~%.2fm\n", getSignalBar(rssiExp).c_str(), rssiExp, distExp);
  }
  Serial.println("==================================================================");
}

// ----------------------------------------------------------------------------
// 11. Setup
// ----------------------------------------------------------------------------
void probeAllPins() {
  constexpr size_t probePinCount = sizeof(PROBE_PINS) / sizeof(PROBE_PINS[0]);
  static int lastState[probePinCount];
  static bool stateInitialized = false;
  if (!stateInitialized) {
    for (size_t i = 0; i < probePinCount; ++i) lastState[i] = -1;
    stateInitialized = true;
  }
  for (size_t i = 0; i < probePinCount; ++i) {
    const uint8_t p = PROBE_PINS[i];
    const int val = digitalRead(p);
    if (lastState[i] != -1 && lastState[i] != val) {
      Serial.printf(">>> [PIN ACTIVITY] GPIO %d changed to %s <<<\n",
                    p, val == LOW ? "LOW (GND - PRESSED)" : "HIGH (3.3V - RELEASED)");
    }
    lastState[i] = val;
  }
}

void sampleShelfInputs(void*) {
  for (;;) {
    for (Lane& lane : lanes) sampleLane(lane);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  if (!eventOutbox.begin()) {
    Serial.println("Cannot allocate event outbox");
    while (true) delay(1000);
  }


  // Initialize NimBLE stack FIRST before querying MAC or scan
  NimBLEDevice::init(SHELF_ID);

  bootId = esp_random();

  Serial.println("\n==================================================================");
  Serial.printf("     Basketly — Local MQTT & Shelf Firmware (%s)           \n", SHELF_ID);
  Serial.println("==================================================================");
  Serial.printf("Shelf ID      : %s\n", SHELF_ID);
  Serial.printf("ESP32 BLE MAC : %s\n", NimBLEDevice::getAddress().toString().c_str());
  Serial.printf("Local MQTT    : %s:%u\n", LOCAL_MQTT_HOST, LOCAL_MQTT_PORT);
  Serial.printf("Switches      : Coke = GPIO %d, Water = GPIO %d\n", COKE_SWITCH_PIN, WATER_SWITCH_PIN);
  Serial.printf("Target Tags   : Basket A, Basket B, Expensive Item\n");
  Serial.println("==================================================================\n");

  // Configure MQTT Client
  mqttClient.setServer(LOCAL_MQTT_HOST, LOCAL_MQTT_PORT);
  mqttClient.setBufferSize(1024);
  mqttClient.setSocketTimeout(2);
  mqttClient.setCallback(onMqttCommand);

  // Initialize probe pins to catch wrong pin wiring
  for (uint8_t p : PROBE_PINS) {
    pinMode(p, INPUT_PULLUP);
  }

  // Attach hardware interrupts on switch pins to capture any edge
  attachInterrupt(digitalPinToInterrupt(COKE_SWITCH_PIN), isrCoke, CHANGE);
  attachInterrupt(digitalPinToInterrupt(WATER_SWITCH_PIN), isrWater, CHANGE);

  // Initialize switches without firing events
  for (Lane& lane : lanes) {
    pinMode(lane.pin, INPUT_PULLUP);
    lane.stablePresent = (digitalRead(lane.pin) == LOW);
    lane.candidatePresent = lane.stablePresent;
    lane.candidateSince = millis();
    Serial.printf("[INIT] %s (%s): %s\n", lane.laneId, lane.sku, lane.stablePresent ? "PRESENT" : "EMPTY");
  }

  // Register Wi-Fi Access Points (Primary Router 2.4 GHz + Fallback Hotspot)
  WiFi.mode(WIFI_STA);
  if (strcmp(WIFI_SSID, "YOUR_WIFI_SSID") != 0 && strlen(WIFI_SSID)) wifiMulti.addAP(WIFI_SSID, WIFI_PASSWORD);
#ifdef WIFI_FALLBACK_SSID
  wifiMulti.addAP(WIFI_FALLBACK_SSID, WIFI_FALLBACK_PASSWORD);
#endif


  Serial.println("[Wi-Fi] Connecting using local secrets.h configuration");

  if (xTaskCreate(sampleShelfInputs, "shelf-inputs", 4096, nullptr, 2, nullptr) != pdPASS) {
    Serial.println("Cannot start independent sensor task");
    while (true) delay(1000);
  }
  // Initialize BLE Scanner
  pBLEScan = NimBLEDevice::getScan();
  pBLEScan->setScanCallbacks(&scanCallbacks, true);
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(65);
  pBLEScan->setDuplicateFilter(false);
  pBLEScan->start(0, false);
  Serial.println("[BLE] Continuous scan started.");
}

// ----------------------------------------------------------------------------
// 12. Main Loop
// ----------------------------------------------------------------------------
void loop() {
  const uint32_t now = millis();

  // Maintain Wi-Fi and Local MQTT connections
  maintainWifi();
  maintainMqtt();
  pumpEvents();

  // Probe all GPIOs for testing / wrong-pin detection
  probeAllPins();

  // Sample switches

  // Periodic Telemetry (1 Hz)
  if (now - lastTelemetryMs >= 1000) {
    lastTelemetryMs = now;
    publishTelemetry();
  }

  // Periodically display monitor dashboard (every 2 seconds)
  if (now - lastDashboardMs >= 2000) {
    lastDashboardMs = now;
    printDashboard();
  }

  delay(5);
}
