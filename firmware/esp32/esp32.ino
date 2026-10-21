#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <cmath>

// ============================================================================
// Basketly — Main Smart Shelf Firmware (Local / USB & Direct Prototype)
// File: firmware/esp32/esp32.ino
// 
// Use this sketch for:
//   1. Local testing with USB Serial Monitor (no Wi-Fi needed).
//   2. Local testing with your laptop prototype server (HTTP POST to /api/events).
//   For AWS IoT Core MQTT/TLS deployment, see: firmware/esp32/aws_shelf/aws_shelf.ino
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Wi-Fi & Local Server Configuration
// ----------------------------------------------------------------------------
// Set your 2.4 GHz Wi-Fi credentials (or leave empty for Serial-only mode)
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Local Laptop / Node.js server address (e.g. your laptop's Wi-Fi IP)
const char* LOCAL_SERVER_HOST = "192.168.1.100";
const uint16_t LOCAL_SERVER_PORT = 3000;

// Enable / Disable HTTP publishing to local server
// If true, attempts to send HTTP POST to http://<LOCAL_SERVER_HOST>:<PORT>/api/events
bool ENABLE_LOCAL_HTTP = false; 

// ----------------------------------------------------------------------------
// 2. Hardware Microswitch Pins (Roller switches: COM -> GND, NO -> GPIO pin)
// ----------------------------------------------------------------------------
constexpr uint8_t COKE_SWITCH_PIN     = 26; // Lane 1: Coca-Cola
constexpr uint8_t WATER_SWITCH_PIN    = 27; // Lane 2: Mineral Water
constexpr uint32_t SWITCH_DEBOUNCE_MS = 80; // 80 ms stable debounce

// ----------------------------------------------------------------------------
// 3. BLE Beacons Configuration (3 Tags: Basket A, Basket B, Expensive Product)
// ----------------------------------------------------------------------------
// Target MAC addresses (lowercase or without colons) - matched against your physical beacons
String BASKET_A_MAC       = "48:87:2d:9e:3e:c5"; // Beacon 1 (Basket A): 48872D9E3EC5
String BASKET_B_MAC       = "48:87:2d:9e:3c:0e"; // Beacon 2 (Basket B): 48872D9E3C0E
String EXPENSIVE_ITEM_MAC = "48:87:2d:9e:3e:49"; // Beacon 3 (High-Value): 48872D9E3E49

// Standard iBeacon Major / Minor identities (docs/iot-roadmap.md)
constexpr uint16_t BASKET_A_MAJOR       = 1;
constexpr uint16_t BASKET_A_MINOR       = 1;
constexpr uint16_t BASKET_B_MAJOR       = 1;
constexpr uint16_t BASKET_B_MINOR       = 2;
constexpr uint16_t EXPENSIVE_ITEM_MAJOR = 1;
constexpr uint16_t EXPENSIVE_ITEM_MINOR = 3;

constexpr char SHELF_ID[]          = "SHELF-01";
constexpr char EXPENSIVE_ITEM_ID[] = "HV-001";
constexpr uint32_t TAG_FRESH_MS    = 5000; // 5000 ms freshness window
constexpr size_t RSSI_WINDOW       = 5;    // 5-sample rolling median
constexpr int CLEAR_MARGIN_DB      = 10;   // 10 dB clear lead threshold

// ----------------------------------------------------------------------------
// 4. Data Types & State
// ----------------------------------------------------------------------------
enum BeaconRole {
  ROLE_BASKET_A = 0,
  ROLE_BASKET_B = 1,
  ROLE_EXPENSIVE_ITEM = 2,
  ROLE_COUNT = 3
};

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
};

TrackedBeacon trackedBeacons[ROLE_COUNT] = {
  {"Basket A",       BASKET_A_MAC,       BASKET_A_MAJOR,       BASKET_A_MINOR,       "", 0, {}, 0, 0, 0, -59, 0},
  {"Basket B",       BASKET_B_MAC,       BASKET_B_MAJOR,       BASKET_B_MINOR,       "", 0, {}, 0, 0, 0, -59, 0},
  {"Expensive Item", EXPENSIVE_ITEM_MAC, EXPENSIVE_ITEM_MAJOR, EXPENSIVE_ITEM_MINOR, "", 0, {}, 0, 0, 0, -59, 0}
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

portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;
WiFiClient rawClient;
NimBLEScan* pBLEScan = nullptr;

uint32_t eventSeq = 0;
uint16_t bootId = 0;
uint32_t lastDashboardMs = 0;
uint32_t lastWifiCheckMs = 0;

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
  int8_t samples[RSSI_WINDOW];
  uint8_t count = 0;
  uint32_t lastSeen = 0;

  portENTER_CRITICAL(&bleMux);
  count = trackedBeacons[role].rssiCount;
  lastSeen = trackedBeacons[role].lastSeenMs;
  for (uint8_t i = 0; i < count; ++i) {
    samples[i] = trackedBeacons[role].rssiHistory[i];
  }
  portEXIT_CRITICAL(&bleMux);

  isFresh = (count > 0) && ((millis() - lastSeen) <= TAG_FRESH_MS);
  if (!isFresh || count == 0) return 0;

  for (uint8_t i = 0; i < count; ++i) {
    for (uint8_t j = i + 1; j < count; ++j) {
      if (samples[j] < samples[i]) {
        const int8_t tmp = samples[i];
        samples[i] = samples[j];
        samples[j] = tmp;
      }
    }
  }
  return samples[count / 2];
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

  if (lastSeen == 0) return "NOT_YET_SEEN";
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
      isIBeacon = decodeIBeacon(reinterpret_cast<const uint8_t*>(mfg.data()), mfg.length(),
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
        if (trackedBeacons[r].targetMajor == major && trackedBeacons[r].targetMinor == minor) {
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
    b.rssiHead = (b.rssiHead + 1) % RSSI_WINDOW;
    if (b.rssiCount < RSSI_WINDOW) ++b.rssiCount;
    b.lastSeenMs = millis();
    b.packetsCount++;
    portEXIT_CRITICAL(&bleMux);
  }
};

LocalScanCallbacks scanCallbacks;

// ----------------------------------------------------------------------------
// 7. Event Dispatch (Serial & Local HTTP)
// ----------------------------------------------------------------------------
void postEventToLocalServer(const char* jsonPayload) {
  if (!ENABLE_LOCAL_HTTP || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  char url[128];
  snprintf(url, sizeof(url), "http://%s:%u/api/events", LOCAL_SERVER_HOST, LOCAL_SERVER_PORT);
  http.begin(rawClient, url);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(jsonPayload)), strlen(jsonPayload));
  if (code >= 200 && code < 300) {
    Serial.printf("[HTTP] Successfully dispatched to %s (HTTP %d)\n", url, code);
  } else {
    Serial.printf("[HTTP] POST failed (HTTP %d)\n", code);
  }
  http.end();
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

  char eventId[40];
  snprintf(eventId, sizeof(eventId), "esp32-%04x-%04lu", bootId, static_cast<unsigned long>(++eventSeq));

  // Build JSON payload conforming to requirements
  char payload[384];
  snprintf(payload, sizeof(payload),
    "{\"eventId\":\"%s\",\"shelfId\":\"%s\",\"laneId\":\"%s\",\"sku\":\"%s\","
    "\"eventType\":\"%s\",\"timestamp\":\"\","
    "\"rssi\":{\"A\":%s,\"B\":%s,\"HV01\":%s}}",
    eventId, SHELF_ID, lane.laneId, lane.sku, eventType,
    freshA   ? String(rssiA).c_str()   : "null",
    freshB   ? String(rssiB).c_str()   : "null",
    freshExp ? String(rssiExp).c_str() : "null");

  // Visual Event Banner on Serial
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

  postEventToLocalServer(payload);
}

// ----------------------------------------------------------------------------
// 8. Switch Sampling (Active-Low Debounce)
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
// 9. Periodic Dashboard (every 2 seconds)
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
  Serial.printf(" [LOCAL MONITOR] Shelf: %s | Uptime: %lus | Wi-Fi: %s\n",
                SHELF_ID, static_cast<unsigned long>(millis() / 1000),
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "Disconnected (Serial Only)");
  Serial.println("------------------------------------------------------------------");
  Serial.println(" PHYSICAL SWITCHES:");
  Serial.printf("   - %s (%-5s) : [ %-7s ] (Pin %d)\n",
                lanes[0].laneId, lanes[0].sku, lanes[0].stablePresent ? "PRESENT" : "EMPTY", lanes[0].pin);
  Serial.printf("   - %s (%-5s) : [ %-7s ] (Pin %d)\n",
                lanes[1].laneId, lanes[1].sku, lanes[1].stablePresent ? "PRESENT" : "EMPTY", lanes[1].pin);

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
// 10. Setup
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize NimBLE stack first before querying MAC or scan
  NimBLEDevice::init(SHELF_ID);

  bootId = static_cast<uint16_t>(esp_random() & 0xffff);

  Serial.println("\n==================================================================");
  Serial.println("     Basketly — Local Shelf Firmware (Local / USB Testing)        ");
  Serial.println("==================================================================");
  Serial.printf("Shelf ID      : %s\n", SHELF_ID);
  Serial.printf("ESP32 BLE MAC : %s\n", NimBLEDevice::getAddress().toString().c_str());
  Serial.printf("Switches      : Coke = GPIO %d, Water = GPIO %d\n", COKE_SWITCH_PIN, WATER_SWITCH_PIN);
  Serial.printf("Target Tags   : Basket A (1/1), Basket B (1/2), Expensive Item (1/3)\n");
  Serial.println("==================================================================\n");

  // Initialize switches without firing events
  for (Lane& lane : lanes) {
    pinMode(lane.pin, INPUT_PULLUP);
    lane.stablePresent = (digitalRead(lane.pin) == LOW);
    lane.candidatePresent = lane.stablePresent;
    lane.candidateSince = millis();
    Serial.printf("[INIT] %s (%s): %s\n", lane.laneId, lane.sku, lane.stablePresent ? "PRESENT" : "EMPTY");
  }

  // Connect Wi-Fi if enabled
  if (ENABLE_LOCAL_HTTP && strlen(WIFI_SSID) > 0 && strcmp(WIFI_SSID, "YOUR_WIFI_SSID") != 0) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[Wi-Fi] Connecting to %s...\n", WIFI_SSID);
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
// 11. Main Loop
// ----------------------------------------------------------------------------
void loop() {
  const uint32_t now = millis();

  // Sample switches
  for (Lane& lane : lanes) {
    sampleLane(lane);
  }

  // Periodically display monitor dashboard (every 2 seconds)
  if (now - lastDashboardMs >= 2000) {
    lastDashboardMs = now;
    printDashboard();
  }

  delay(5);
}
