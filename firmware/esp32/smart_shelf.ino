#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include <time.h>
#include "secrets.h"

// Microswitch closes while a product is resting on its lane.
constexpr uint8_t COKE_SWITCH_PIN = 26;
constexpr uint8_t WATER_SWITCH_PIN = 27;
constexpr uint32_t SWITCH_DEBOUNCE_MS = 80;
constexpr uint32_t TAG_FRESH_MS = 5000;
constexpr size_t RSSI_WINDOW = 5;
constexpr uint8_t OUTBOX_CAPACITY = 8;
constexpr char SHELF_ID[] = "SHELF-01";
constexpr char EVENT_TOPIC[] = "smartbasket/shelf/SHELF-01/events";
constexpr char BASKET_A_MAC[] = "aa:bb:cc:dd:ee:01";
constexpr char BASKET_B_MAC[] = "aa:bb:cc:dd:ee:02";

WiFiClientSecure tls;
PubSubClient mqtt(tls);
NimBLEScan* bleScan = nullptr;
portMUX_TYPE rssiMux = portMUX_INITIALIZER_UNLOCKED;

struct Lane {
  uint8_t pin;
  const char* laneId;
  const char* sku;
  bool stablePresent;
  bool candidatePresent;
  uint32_t candidateSince;
};

Lane lanes[] = {
  {COKE_SWITCH_PIN, "LANE-1", "COKE", false, false, 0},
  {WATER_SWITCH_PIN, "LANE-2", "WATER", false, false, 0},
};

int8_t rssiSamples[2][RSSI_WINDOW] = {};
uint8_t rssiCount[2] = {};
uint8_t rssiHead[2] = {};
uint32_t tagLastSeen[2] = {};
uint32_t eventSequence = 0;
char outbox[OUTBOX_CAPACITY][320] = {};
uint8_t outboxHead = 0;
uint8_t outboxCount = 0;

int8_t medianRssi(uint8_t basketIndex, bool& isFresh) {
  int8_t values[RSSI_WINDOW] = {};
  uint8_t count = 0;
  uint32_t lastSeen = 0;
  portENTER_CRITICAL(&rssiMux);
  count = rssiCount[basketIndex];
  lastSeen = tagLastSeen[basketIndex];
  for (uint8_t i = 0; i < count; ++i) values[i] = rssiSamples[basketIndex][i];
  portEXIT_CRITICAL(&rssiMux);

  isFresh = count > 0 && (millis() - lastSeen) <= TAG_FRESH_MS;
  if (!isFresh) return 0;
  for (uint8_t i = 0; i < count; ++i) {
    for (uint8_t j = i + 1; j < count; ++j) {
      if (values[j] < values[i]) {
        const int8_t tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
      }
    }
  }
  return values[count / 2];
}

class BasketTagCallbacks final : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) override {
    String address = device->getAddress().toString().c_str();
    address.toLowerCase();
    int basketIndex = -1;
    if (address == BASKET_A_MAC) basketIndex = 0;
    if (address == BASKET_B_MAC) basketIndex = 1;
    if (basketIndex < 0) return;

    portENTER_CRITICAL(&rssiMux);
    rssiSamples[basketIndex][rssiHead[basketIndex]] = static_cast<int8_t>(device->getRSSI());
    rssiHead[basketIndex] = (rssiHead[basketIndex] + 1) % RSSI_WINDOW;
    if (rssiCount[basketIndex] < RSSI_WINDOW) ++rssiCount[basketIndex];
    tagLastSeen[basketIndex] = millis();
    portEXIT_CRITICAL(&rssiMux);
  }
};

BasketTagCallbacks tagCallbacks;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 12000) delay(250);
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  char clientId[32];
  snprintf(clientId, sizeof(clientId), "smart-shelf-%06lx", static_cast<unsigned long>(ESP.getEfuseMac() & 0xffffff));
  mqtt.connect(clientId);
}

String utcTimestamp() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return "";
  struct tm utc;
  gmtime_r(&now, &utc);
  char text[25];
  strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(text);
}

void publishShelfEvent(const Lane& lane, const char* eventType) {
  bool freshA = false;
  bool freshB = false;
  const int8_t rssiA = medianRssi(0, freshA);
  const int8_t rssiB = medianRssi(1, freshB);
  const String timestamp = utcTimestamp();
  char eventId[40];
  snprintf(eventId, sizeof(eventId), "%06lx-%lu",
    static_cast<unsigned long>(esp_random() & 0xffffff), static_cast<unsigned long>(++eventSequence));

  char payload[320];
  snprintf(payload, sizeof(payload),
    "{\"eventId\":\"%s\",\"shelfId\":\"%s\",\"laneId\":\"%s\",\"sku\":\"%s\","
    "\"eventType\":\"%s\",\"timestamp\":\"%s\",\"rssi\":{\"A\":%s,\"B\":%s}}",
    eventId, SHELF_ID, lane.laneId, lane.sku, eventType, timestamp.c_str(),
    freshA ? String(rssiA).c_str() : "null",
    freshB ? String(rssiB).c_str() : "null");

  if (outboxCount == OUTBOX_CAPACITY) {
    Serial.println("Outbox full; event dropped");
    return;
  }
  const uint8_t tail = (outboxHead + outboxCount) % OUTBOX_CAPACITY;
  strlcpy(outbox[tail], payload, sizeof(outbox[tail]));
  ++outboxCount;
  Serial.printf("Queued %s %s\n", eventId, payload);
}

void flushOutbox() {
  while (mqtt.connected() && outboxCount > 0) {
    if (!mqtt.publish(EVENT_TOPIC, outbox[outboxHead], false)) return;
    outboxHead = (outboxHead + 1) % OUTBOX_CAPACITY;
    --outboxCount;
  }
}

void sampleLane(Lane& lane) {
  const bool present = digitalRead(lane.pin) == LOW;
  const uint32_t now = millis();

  if (present != lane.candidatePresent) {
    lane.candidatePresent = present;
    lane.candidateSince = now;
    return;
  }
  if (present == lane.stablePresent || now - lane.candidateSince < SWITCH_DEBOUNCE_MS) return;

  lane.stablePresent = present;
  publishShelfEvent(lane, present ? "PUT_BACK" : "PICK");
}

void setup() {
  Serial.begin(115200);
  pinMode(COKE_SWITCH_PIN, INPUT_PULLUP);
  pinMode(WATER_SWITCH_PIN, INPUT_PULLUP);
  for (Lane& lane : lanes) {
    lane.stablePresent = digitalRead(lane.pin) == LOW;
    lane.candidatePresent = lane.stablePresent;
    lane.candidateSince = millis();
  }

  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  tls.setCACert(AWS_ROOT_CA);
  tls.setCertificate(DEVICE_CERTIFICATE);
  tls.setPrivateKey(DEVICE_PRIVATE_KEY);
  mqtt.setServer(AWS_IOT_ENDPOINT, 8883);
  mqtt.setBufferSize(512);
  connectMqtt();

  NimBLEDevice::init("SB-SHELF-01");
  bleScan = NimBLEDevice::getScan();
  bleScan->setScanCallbacks(&tagCallbacks, true);
  bleScan->setActiveScan(false);
  bleScan->setInterval(100);
  bleScan->setWindow(65);
  bleScan->start(0, false);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  flushOutbox();
  for (Lane& lane : lanes) sampleLane(lane);
  delay(10);
}
