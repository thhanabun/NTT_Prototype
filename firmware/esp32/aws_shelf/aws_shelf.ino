#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include <time.h>
#include <cmath>

// ============================================================================
// SmartBasket (Basketly) — ESP32 Smart Shelf Firmware (AWS IoT Core)
// Folder: firmware/esp32/aws_shelf/aws_shelf.ino
// Specification: NTT_Prototype/docs/esp32-firmware-requirements.md (v1.0.0)
// Target Hardware: ESP32-WROOM-32 Dev Module
// Features:
//   - 2 Roller microswitches (Coke / Water lanes) with 80 ms active-low debounce
//   - 3 BLE beacons tracking: Basket A, Basket B, High-Value Asset (HV-001)
//   - 5-sample rolling median filter & 5000 ms freshness window
//   - High-Value Presence State Machine (RECENTLY_SEEN, STALE, NOT_YET_SEEN)
//   - MQTT over TLS 1.2 (Port 8883) to AWS IoT Core (Events + 1 Hz Telemetry)
//   - Non-blocking Wi-Fi/MQTT reconnection & 8-slot RAM Outbox queue
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Secrets & Credentials (Loaded from secrets.h, fallback guards for safety)
// ----------------------------------------------------------------------------
#if __has_include("../secrets.h")
  #include "../secrets.h"
#elif __has_include("secrets.h")
  #include "secrets.h"
#else
  #include "../secrets.example.h"
#endif
#if defined(SHELF_AWS_CREDENTIAL_HEADER)
  #include SHELF_AWS_CREDENTIAL_HEADER
#elif __has_include("../../../data/aws-device/aws-credentials.h")
  #define SHELF_AWS_CREDENTIAL_HEADER "../../../data/aws-device/aws-credentials.h"
  #include SHELF_AWS_CREDENTIAL_HEADER
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
#if defined(SHELF_AWS_CREDENTIAL_HEADER)
constexpr const char* ACTIVE_AWS_IOT_ENDPOINT = AWS_DEVICE_ENDPOINT;
constexpr const char* ACTIVE_AWS_ROOT_CA = AWS_DEVICE_ROOT_CA;
constexpr const char* ACTIVE_DEVICE_CERTIFICATE = AWS_DEVICE_CERTIFICATE;
constexpr const char* ACTIVE_DEVICE_PRIVATE_KEY = AWS_DEVICE_PRIVATE_KEY;
#else
constexpr const char* ACTIVE_AWS_IOT_ENDPOINT = AWS_IOT_ENDPOINT;
constexpr const char* ACTIVE_AWS_ROOT_CA = AWS_ROOT_CA;
constexpr const char* ACTIVE_DEVICE_CERTIFICATE = DEVICE_CERTIFICATE;
constexpr const char* ACTIVE_DEVICE_PRIVATE_KEY = DEVICE_PRIVATE_KEY;
#endif


// ----------------------------------------------------------------------------
// 2. Hardware Pin Configuration & Constants (Section 2)
// ----------------------------------------------------------------------------
// Microswitch wiring: COM -> GND, NO -> GPIO pin (INPUT_PULLUP)
// Closed = LOW (Product PRESENT); Open = HIGH (Product EMPTY)
constexpr uint8_t COKE_SWITCH_PIN     = SHELF_SWITCH_COKE_GPIO; // Lane 1: Coca-Cola
constexpr uint8_t WATER_SWITCH_PIN    = SHELF_SWITCH_WATER_GPIO; // Lane 2: Mineral Water
constexpr uint32_t SWITCH_DEBOUNCE_MS = 80; // FR-1.2: 80 ms stable debounce

// ----------------------------------------------------------------------------
// 3. BLE Beacon Configuration (Section 2 & FR-2)
// ----------------------------------------------------------------------------
constexpr const char* HIGH_VALUE_MAC = EXPENSIVE_ITEM_MAC;

// iBeacon standard Major / Minor identities (docs/iot-roadmap.md)
constexpr uint16_t BASKET_A_MAJOR     = 1;
constexpr uint16_t BASKET_A_MINOR     = 1;
constexpr uint16_t BASKET_B_MAJOR     = 1;
constexpr uint16_t BASKET_B_MINOR     = 2;
constexpr uint16_t HIGH_VALUE_MAJOR   = 1;
constexpr uint16_t HIGH_VALUE_MINOR   = 3;

constexpr char HIGH_VALUE_TAG_ID[]    = "HV-001";
constexpr char SHELF_ID[]             = SHELF_ID_VALUE;

constexpr uint32_t TAG_FRESH_MS       = 5000; // FR-2.4: 5000 ms freshness window
constexpr size_t RSSI_WINDOW          = 5;    // FR-2.3: 5-sample rolling median
constexpr uint8_t OUTBOX_CAPACITY     = 8;    // FR-6.3: 8-slot RAM buffer

// Reconnection intervals (non-blocking)
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 5000;
constexpr uint32_t MQTT_RETRY_INTERVAL_MS = 5000;

// AWS IoT Core MQTT Topics (FR-4 & FR-5)
constexpr char TOPIC_EVENTS[]    = "smartbasket/shelf/" SHELF_ID_VALUE "/events";
constexpr char TOPIC_TELEMETRY[] = "smartbasket/shelf/" SHELF_ID_VALUE "/telemetry";

// ----------------------------------------------------------------------------
// 4. Data Types & Global State
// ----------------------------------------------------------------------------
enum BeaconRole {
  ROLE_BASKET_A = 0,
  ROLE_BASKET_B = 1,
  ROLE_HIGH_VALUE = 2,
  ROLE_COUNT = 3
};

struct TrackedBeacon {
  const char* label;
  String targetMac;
  uint16_t targetMajor;
  uint16_t targetMinor;
  int8_t rssiHistory[RSSI_WINDOW];
  uint8_t rssiCount;
  uint8_t rssiHead;
  uint32_t lastSeenMs;
  int8_t txPower;
  uint32_t packetsCount;
  uint32_t rssiAt[RSSI_WINDOW] = {};
};

TrackedBeacon trackedBeacons[ROLE_COUNT] = {
  {"Basket A",       BASKET_A_MAC,   BASKET_A_MAJOR,   BASKET_A_MINOR,   {}, 0, 0, 0, -59, 0},
  {"Basket B",       BASKET_B_MAC,   BASKET_B_MAJOR,   BASKET_B_MINOR,   {}, 0, 0, 0, -59, 0},
  {"High-Value Tag", HIGH_VALUE_MAC, HIGH_VALUE_MAJOR, HIGH_VALUE_MINOR, {}, 0, 0, 0, -59, 0}
};

struct Lane {
  uint8_t pin;
  const char* laneId;
  const char* sku;
  bool stablePresent;
  bool candidatePresent;
  uint32_t candidateSince;
};

Lane lanes[] = {
  {COKE_SWITCH_PIN,  "LANE-1", "COKE",  false, false, 0},
  {WATER_SWITCH_PIN, "LANE-2", "WATER", false, false, 0}
};

// Thread-safe mutex for BLE data access
portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;

ShelfOutbox eventOutbox;
bool ackSubscribed = false;
constexpr char TOPIC_ACKS[] = "smartbasket/shelf/" SHELF_ID_VALUE "/acks";
uint32_t eventSequence = 0;
uint32_t bootId = 0;


// Networking
WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);
NimBLEScan* pBLEScan = nullptr;

uint32_t lastWifiRetryMs = 0;
uint32_t lastMqttRetryMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastDiagnosticsMs = 0;

// ----------------------------------------------------------------------------
// 5. Signal Filtering & Proximity Helpers (FR-2 & FR-3)
// ----------------------------------------------------------------------------

// Decode Apple iBeacon manufacturer payload
bool decodeIBeacon(const uint8_t* data, size_t len, uint16_t& major, uint16_t& minor, int8_t& txPower) {
  if (len < 25) return false;
  if (data[0] != 0x4C || data[1] != 0x00 || data[2] != 0x02 || data[3] != 0x15) {
    return false;
  }
  major = (static_cast<uint16_t>(data[20]) << 8) | data[21];
  minor = (static_cast<uint16_t>(data[22]) << 8) | data[23];
  txPower = static_cast<int8_t>(data[24]);
  return true;
}

// Compute 5-sample rolling median RSSI (FR-2.3 & FR-2.4)
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

// High-Value Asset presence state machine (FR-3.2)
// Returns RECENTLY_SEEN, STALE, or NOT_YET_SEEN
const char* getHighValueStatus(uint32_t& lastSeenAgoMs) {
  uint32_t lastSeen = 0;
  portENTER_CRITICAL(&bleMux);
  lastSeen = trackedBeacons[ROLE_HIGH_VALUE].lastSeenMs;
  portEXIT_CRITICAL(&bleMux);

  if (trackedBeacons[ROLE_HIGH_VALUE].rssiCount == 0) {
    lastSeenAgoMs = 0;
    return "NOT_YET_SEEN";
  }
  const uint32_t elapsed = millis() - lastSeen;
  lastSeenAgoMs = elapsed;
  if (elapsed <= TAG_FRESH_MS) {
    return "RECENTLY_SEEN";
  }
  return "STALE";
}

// ----------------------------------------------------------------------------
// 6. NimBLE Scan Callbacks (FR-2.1 & FR-2.2)
// ----------------------------------------------------------------------------
class ShelfBLECallbacks final : public NimBLEScanCallbacks {
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

    // Match by MAC address
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

    // Match by iBeacon Major / Minor if MAC did not match
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

ShelfBLECallbacks bleCallbacks;

// ----------------------------------------------------------------------------
// 7. Time & NTP Synchronization (FR-6.1)
// ----------------------------------------------------------------------------
String getUtcIsoTimestamp() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return "";
  struct tm utc;
  gmtime_r(&now, &utc);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buf);
}

// ----------------------------------------------------------------------------
// 8. Non-blocking Network Management (FR-6.4)
// ----------------------------------------------------------------------------
void maintainNetworkNonBlocking() {
  const uint32_t now = millis();

  // 1. Non-blocking Wi-Fi reconnection
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetryMs = now;
      if (strlen(WIFI_SSID) > 0 && strcmp(WIFI_SSID, "YOUR_WIFI_SSID") != 0) {
        Serial.printf("[Wi-Fi] Connecting to '%s' (non-blocking)...\n", WIFI_SSID);
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
    }
    return;
  }

  // 2. Non-blocking MQTT reconnection
  if (!mqttClient.connected()) {
    if (now - lastMqttRetryMs >= MQTT_RETRY_INTERVAL_MS) {
      lastMqttRetryMs = now;
      const char* clientId = SHELF_ID;
      Serial.printf("[MQTT] Connecting to AWS IoT Core as '%s'...\n", clientId);
      ackSubscribed = false;
      if (mqttClient.connect(clientId)) {
        ackSubscribed = mqttClient.subscribe(TOPIC_ACKS, 1);
        if (!ackSubscribed) { mqttClient.disconnect(); return; }
        eventOutbox.setReady(true);
        Serial.println("[MQTT] Connected to AWS IoT Core!");
      } else {
        Serial.printf("[MQTT] Connect failed (state=%d); will retry in %lu ms\n",
                      mqttClient.state(), static_cast<unsigned long>(MQTT_RETRY_INTERVAL_MS));
      }
    }
    return;
  }

  mqttClient.loop();
}

// ----------------------------------------------------------------------------
// 9. Fault-Tolerant Outbox Ring Buffer (FR-6.3)
// ----------------------------------------------------------------------------
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, TOPIC_ACKS) != 0 || length >= 48) return;
  char id[48] = {};
  memcpy(id, payload, length);
  eventOutbox.acknowledge(id);
}

void flushOutbox() {
  eventOutbox.setReady(WiFi.status() == WL_CONNECTED && mqttClient.connected() && ackSubscribed);
  eventOutbox.pump(millis(), [](const char*, const char* payload) { return mqttClient.publish(TOPIC_EVENTS, payload, false); });
}


// ----------------------------------------------------------------------------
// 10. Shelf Switch Event Generator (FR-1, FR-3.3, FR-4)
// ----------------------------------------------------------------------------
void triggerShelfEvent(const Lane& lane, const char* eventType) {
  bool freshA = false;
  bool freshB = false;
  bool freshHV = false;

  const int8_t rssiA  = getMedianRssi(ROLE_BASKET_A, freshA);
  const int8_t rssiB  = getMedianRssi(ROLE_BASKET_B, freshB);
  const int8_t rssiHV = getMedianRssi(ROLE_HIGH_VALUE, freshHV);

  uint32_t nextSequence;
  portENTER_CRITICAL(&bleMux);
  nextSequence = ++eventSequence;
  portEXIT_CRITICAL(&bleMux);
  char eventId[40];
  snprintf(eventId, sizeof(eventId), "esp32-%04x-%04lu",
           bootId, static_cast<unsigned long>(nextSequence));

  const String timestamp = getUtcIsoTimestamp();

  char payload[384];
  snprintf(payload, sizeof(payload),
    "{\"eventId\":\"%s\",\"shelfId\":\"%s\",\"laneId\":\"%s\",\"sku\":\"%s\","
    "\"eventType\":\"%s\",\"delayed\":false,\"timestamp\":\"%s\","
    "\"rssi\":{\"A\":%s,\"B\":%s,\"HV01\":%s}}",
    eventId, SHELF_ID, lane.laneId, lane.sku, eventType, timestamp.c_str(),
    freshA  ? String(rssiA).c_str()  : "null",
    freshB  ? String(rssiB).c_str()  : "null",
    freshHV ? String(rssiHV).c_str() : "null");

  Serial.println("\n--------------------------------------------------");
  Serial.printf("[EVENT] %s %s %s -> %s\n", lane.laneId, lane.sku, eventType, eventId);
  Serial.printf("  Payload: %s\n", payload);
  Serial.println("--------------------------------------------------");

  if (!eventOutbox.enqueue(eventId, payload, WiFi.status() == WL_CONNECTED)) Serial.println("[OUTBOX] Full; event dropped");
}

// ----------------------------------------------------------------------------
// 11. Switch Sampling with 80 ms Active-Low Debounce (FR-1)
// ----------------------------------------------------------------------------
void sampleLane(Lane& lane) {
  const bool present = (digitalRead(lane.pin) == LOW);
  const uint32_t now = millis();

  if (present != lane.candidatePresent) {
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
// 12. Periodic 1 Hz Telemetry & Heartbeat (FR-5)
// ----------------------------------------------------------------------------
void publishTelemetry() {
  if (!mqttClient.connected()) return;

  bool freshA = false;
  bool freshB = false;
  bool freshHV = false;
  const int8_t rssiA  = getMedianRssi(ROLE_BASKET_A, freshA);
  const int8_t rssiB  = getMedianRssi(ROLE_BASKET_B, freshB);
  const int8_t rssiHV = getMedianRssi(ROLE_HIGH_VALUE, freshHV);

  uint32_t lastSeenAgoMs = 0;
  const char* hvStatus = getHighValueStatus(lastSeenAgoMs);

  char telemPayload[384];
  char agoBuffer[16];
  if (strcmp(hvStatus, "NOT_YET_SEEN") == 0) {
    snprintf(agoBuffer, sizeof(agoBuffer), "null");
  } else {
    snprintf(agoBuffer, sizeof(agoBuffer), "%lu", static_cast<unsigned long>(lastSeenAgoMs));
  }

  snprintf(telemPayload, sizeof(telemPayload),
    "{\"shelfId\":\"%s\",\"uptime\":%lu,\"queueDepth\":%u,\"droppedEvents\":%lu,"
    "\"highValueItem\":{\"tagId\":\"%s\",\"status\":\"%s\",\"rssi\":%s,\"lastSeenMsAgo\":%s},"
    "\"baskets\":{\"A\":%s,\"B\":%s}}",
    SHELF_ID,
    static_cast<unsigned long>(millis() / 1000),
    eventOutbox.depth(),
    static_cast<unsigned long>(eventOutbox.dropped()),
    HIGH_VALUE_TAG_ID,
    hvStatus,
    freshHV ? String(rssiHV).c_str() : "null",
    agoBuffer,
    freshA ? String(rssiA).c_str() : "null",
    freshB ? String(rssiB).c_str() : "null");

  mqttClient.publish(TOPIC_TELEMETRY, telemPayload, false);
}

// ----------------------------------------------------------------------------
// 13. Serial Monitor Diagnostics (every 2 seconds)
// ----------------------------------------------------------------------------
void printDiagnostics() {
  bool freshA = false, freshB = false, freshHV = false;
  const int8_t rssiA  = getMedianRssi(ROLE_BASKET_A, freshA);
  const int8_t rssiB  = getMedianRssi(ROLE_BASKET_B, freshB);
  const int8_t rssiHV = getMedianRssi(ROLE_HIGH_VALUE, freshHV);

  uint32_t lastSeenAgoMs = 0;
  const char* hvStatus = getHighValueStatus(lastSeenAgoMs);

  Serial.printf("\n[DIAG #%lu | Uptime %lus] Outbox: %u | Dropped: %lu | Wi-Fi: %s | MQTT: %s\n",
                static_cast<unsigned long>(millis() / 2000),
                static_cast<unsigned long>(millis() / 1000),
                eventOutbox.depth(),
                static_cast<unsigned long>(eventOutbox.dropped()),
                WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED",
                mqttClient.connected() ? "CONNECTED" : "DISCONNECTED");

  Serial.printf("  Lanes   : %s=%s | %s=%s\n",
                lanes[0].sku, lanes[0].stablePresent ? "PRESENT" : "EMPTY",
                lanes[1].sku, lanes[1].stablePresent ? "PRESENT" : "EMPTY");

  Serial.printf("  Basket A: %s dBm (%s) | Basket B: %s dBm (%s)\n",
                freshA ? String(rssiA).c_str() : "null", freshA ? "FRESH" : "STALE",
                freshB ? String(rssiB).c_str() : "null", freshB ? "FRESH" : "STALE");

  Serial.printf("  Asset   : %s | Status: %s | RSSI: %s dBm | LastSeen: %lums ago\n",
                HIGH_VALUE_TAG_ID, hvStatus,
                freshHV ? String(rssiHV).c_str() : "null",
                static_cast<unsigned long>(lastSeenAgoMs));
}

// ----------------------------------------------------------------------------
// 14. Setup
// ----------------------------------------------------------------------------
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


  // Initialize NimBLE stack first before querying MAC or scan
  NimBLEDevice::init(SHELF_ID);

  bootId = esp_random();

  Serial.println("\n==================================================================");
  Serial.println("  SmartBasket — ESP32 Smart Shelf Firmware (AWS IoT Core Ready)   ");
  Serial.println("==================================================================");
  Serial.printf("Shelf ID      : %s\n", SHELF_ID);
  Serial.printf("Boot ID       : %04x\n", bootId);
  Serial.printf("ESP32 BLE MAC : %s\n", NimBLEDevice::getAddress().toString().c_str());
  Serial.printf("Switches      : Coke = GPIO %d, Water = GPIO %d\n", COKE_SWITCH_PIN, WATER_SWITCH_PIN);
  Serial.printf("Target Tags   : Basket A (%s), Basket B (%s)\n", BASKET_A_MAC, BASKET_B_MAC);
  Serial.printf("High-Value Tag: %s (%s)\n", HIGH_VALUE_TAG_ID, HIGH_VALUE_MAC);
  Serial.printf("AWS IoT Topic : %s\n", TOPIC_EVENTS);
  Serial.println("==================================================================\n");

  for (Lane& lane : lanes) {
    pinMode(lane.pin, INPUT_PULLUP);
    lane.stablePresent = (digitalRead(lane.pin) == LOW);
    lane.candidatePresent = lane.stablePresent;
    lane.candidateSince = millis();
    Serial.printf("[INIT] %s (%s) initial state: %s (No event emitted)\n",
                  lane.laneId, lane.sku, lane.stablePresent ? "PRESENT" : "EMPTY");
  }

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  if (strlen(ACTIVE_AWS_ROOT_CA) > 0) {
    tlsClient.setCACert(ACTIVE_AWS_ROOT_CA);
    tlsClient.setCertificate(ACTIVE_DEVICE_CERTIFICATE);
    tlsClient.setPrivateKey(ACTIVE_DEVICE_PRIVATE_KEY);
  }
  mqttClient.setServer(ACTIVE_AWS_IOT_ENDPOINT, 8883);
  mqttClient.setBufferSize(1024);
  mqttClient.setSocketTimeout(2);
  mqttClient.setCallback(onMqttMessage);

  if (xTaskCreate(sampleShelfInputs, "shelf-inputs", 4096, nullptr, 2, nullptr) != pdPASS) {
    Serial.println("Cannot start independent sensor task");
    while (true) delay(1000);
  }
  pBLEScan = NimBLEDevice::getScan();
  pBLEScan->setScanCallbacks(&bleCallbacks, true);
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(65);
  pBLEScan->setDuplicateFilter(false);
  pBLEScan->start(0, false);
  Serial.println("[BLE] Non-blocking continuous scanning initialized.");
}

// ----------------------------------------------------------------------------
// 15. Main Loop
// ----------------------------------------------------------------------------
void loop() {
  const uint32_t now = millis();


  maintainNetworkNonBlocking();
  flushOutbox();

  if (now - lastTelemetryMs >= 1000) {
    lastTelemetryMs = now;
    publishTelemetry();
  }

  if (now - lastDiagnosticsMs >= 2000) {
    lastDiagnosticsMs = now;
    printDiagnostics();
  }

  delay(5);
}
