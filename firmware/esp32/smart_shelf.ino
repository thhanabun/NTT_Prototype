#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <string>
#include <time.h>
#include <string.h>
#include "secrets.h"

constexpr uint8_t COKE_SWITCH_PIN = 26;
constexpr uint8_t WATER_SWITCH_PIN = 27;
constexpr uint32_t SWITCH_DEBOUNCE_MS = 80;
constexpr uint32_t TAG_FRESH_MS = 5000;
constexpr uint32_t APP_ACK_RETRY_MS = 3000;
constexpr uint32_t WIFI_RETRY_MS = 5000;
constexpr uint32_t MQTT_RETRY_MS = 3000;
constexpr size_t RSSI_WINDOW = 5;
constexpr uint8_t OUTBOX_CAPACITY = 8;
constexpr char SHELF_ID[] = "SHELF-01";
constexpr char EVENT_TOPIC[] = "smartbasket/shelf/SHELF-01/events";
constexpr char ACK_TOPIC[] = "smartbasket/shelf/SHELF-01/acks";

WiFiClientSecure tls;
PubSubClient mqtt(tls);
NimBLEScan* bleScan = nullptr;
QueueHandle_t eventQueue = nullptr;
portMUX_TYPE rssiMux = portMUX_INITIALIZER_UNLOCKED;

struct Lane {
  uint8_t pin;
  const char* laneId;
  const char* sku;
  bool stablePresent;
  bool candidatePresent;
  uint32_t candidateSince;
};

struct QueuedEvent {
  char eventId[48];
  char payload[320];
  uint32_t lastAttemptAt;
  bool attempted;
  bool delayed;
};

Lane lanes[] = {
  {COKE_SWITCH_PIN, "LANE-1", "COKE", false, false, 0},
  {WATER_SWITCH_PIN, "LANE-2", "WATER", false, false, 0},
};

int8_t rssiSamples[2][RSSI_WINDOW] = {};
uint8_t rssiCount[2] = {};
uint8_t rssiHead[2] = {};
uint32_t tagLastSeen[2] = {};
bool tagSeen[2] = {};
uint8_t projectUuid[16] = {};
bool projectUuidValid = false;
QueuedEvent activeEvent = {};
bool hasActiveEvent = false;
bool ackSubscribed = false;
bool timeSyncStarted = false;
volatile bool cloudReady = false;
volatile bool waitingForAck = false;
uint32_t bootIdentifier = 0;
uint32_t eventSequence = 0;
uint32_t droppedEventCount = 0;
uint32_t nextWifiAttemptAt = 0;
uint32_t nextMqttAttemptAt = 0;

int hexNibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

bool parseProjectUuid(const char* text, uint8_t* output) {
  uint8_t byteIndex = 0;
  int highNibble = -1;
  for (const char* cursor = text; *cursor; ++cursor) {
    if (*cursor == '-') continue;
    const int value = hexNibble(*cursor);
    if (value < 0) return false;
    if (highNibble < 0) highNibble = value;
    else {
      if (byteIndex >= 16) return false;
      output[byteIndex++] = static_cast<uint8_t>((highNibble << 4) | value);
      highNibble = -1;
    }
  }
  return byteIndex == 16 && highNibble < 0;
}

int8_t identifyBasketTag(const NimBLEAdvertisedDevice* device) {
  if (!projectUuidValid) return -1;

  for (uint8_t field = 0; field < device->getManufacturerDataCount(); ++field) {
    const std::string data = device->getManufacturerData(field);
    if (data.size() < 25) continue;
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(data.data());
    if (bytes[0] != 0x4c || bytes[1] != 0x00 || bytes[2] != 0x02 || bytes[3] != 0x15) continue;
    if (memcmp(bytes + 4, projectUuid, sizeof(projectUuid)) != 0) continue;

    const uint16_t major = (static_cast<uint16_t>(bytes[20]) << 8) | bytes[21];
    const uint16_t minor = (static_cast<uint16_t>(bytes[22]) << 8) | bytes[23];
    if (major == BASKET_A_MAJOR && minor == BASKET_A_MINOR) return 0;
    if (major == BASKET_B_MAJOR && minor == BASKET_B_MINOR) return 1;
  }
  return -1;
}

int8_t medianRssi(uint8_t basketIndex, bool& isFresh) {
  int8_t values[RSSI_WINDOW] = {};
  uint8_t count = 0;
  uint32_t lastSeen = 0;
  bool seen = false;
  portENTER_CRITICAL(&rssiMux);
  count = rssiCount[basketIndex];
  lastSeen = tagLastSeen[basketIndex];
  seen = tagSeen[basketIndex];
  for (uint8_t i = 0; i < count; ++i) values[i] = rssiSamples[basketIndex][i];
  portEXIT_CRITICAL(&rssiMux);

  isFresh = seen && count > 0 && static_cast<uint32_t>(millis() - lastSeen) <= TAG_FRESH_MS;
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
    const int8_t basketIndex = identifyBasketTag(device);
    if (basketIndex < 0) return;

    portENTER_CRITICAL(&rssiMux);
    rssiSamples[basketIndex][rssiHead[basketIndex]] = static_cast<int8_t>(device->getRSSI());
    rssiHead[basketIndex] = (rssiHead[basketIndex] + 1) % RSSI_WINDOW;
    if (rssiCount[basketIndex] < RSSI_WINDOW) ++rssiCount[basketIndex];
    tagLastSeen[basketIndex] = millis();
    tagSeen[basketIndex] = true;
    portEXIT_CRITICAL(&rssiMux);
  }
};

BasketTagCallbacks tagCallbacks;

String utcTimestamp() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return "";
  struct tm utc;
  gmtime_r(&now, &utc);
  char text[25];
  strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(text);
}

void markDelayed(QueuedEvent& event) {
  if (event.delayed) return;
  char* field = strstr(event.payload, "\"delayed\":false");
  if (field) memcpy(field + 10, "true ", 5);
  event.delayed = true;
}

void queueShelfEvent(const Lane& lane, const char* eventType) {
  QueuedEvent event = {};
  snprintf(event.eventId, sizeof(event.eventId), "%08lx-%lu",
    static_cast<unsigned long>(bootIdentifier), static_cast<unsigned long>(++eventSequence));

  bool freshA = false;
  bool freshB = false;
  const int8_t rssiA = medianRssi(0, freshA);
  const int8_t rssiB = medianRssi(1, freshB);
  const String timestamp = utcTimestamp();
  char timestampField[48] = "";
  if (timestamp.length()) {
    snprintf(timestampField, sizeof(timestampField), "\"timestamp\":\"%s\",", timestamp.c_str());
  }

  event.delayed = !cloudReady || waitingForAck || uxQueueMessagesWaiting(eventQueue) > 0;
  snprintf(event.payload, sizeof(event.payload),
    "{\"eventId\":\"%s\",\"shelfId\":\"%s\",\"laneId\":\"%s\",\"sku\":\"%s\","
    "\"eventType\":\"%s\",%s\"delayed\":%s,\"rssi\":{\"A\":%s,\"B\":%s}}",
    event.eventId, SHELF_ID, lane.laneId, lane.sku, eventType, timestampField,
    event.delayed ? "true" : "false",
    freshA ? String(rssiA).c_str() : "null",
    freshB ? String(rssiB).c_str() : "null");

  if (uxQueueMessagesWaiting(eventQueue) + (waitingForAck ? 1 : 0) >= OUTBOX_CAPACITY ||
    xQueueSend(eventQueue, &event, 0) != pdTRUE) {
    ++droppedEventCount;
    Serial.printf("Outbox full; dropped event %s\n", event.eventId);
    return;
  }
  Serial.printf("Queued %s %s\n", event.eventId, event.payload);
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
  queueShelfEvent(lane, present ? "PUT_BACK" : "PICK");
}

void sampleShelfInputs(void*) {
  for (;;) {
    for (Lane& lane : lanes) sampleLane(lane);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, ACK_TOPIC) != 0 || !hasActiveEvent || length >= sizeof(activeEvent.eventId)) return;
  char eventId[sizeof(activeEvent.eventId)] = {};
  memcpy(eventId, payload, length);
  if (strcmp(eventId, activeEvent.eventId) != 0) return;

  Serial.printf("API acknowledged %s\n", eventId);
  hasActiveEvent = false;
  waitingForAck = false;
  activeEvent = {};
}

void serviceWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!timeSyncStarted) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      timeSyncStarted = true;
    }
    return;
  }

  cloudReady = false;
  ackSubscribed = false;
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - nextWifiAttemptAt) < 0) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  nextWifiAttemptAt = now + WIFI_RETRY_MS;
}

void serviceMqtt() {
  if (WiFi.status() != WL_CONNECTED) {
    cloudReady = false;
    return;
  }

  if (!mqtt.connected()) {
    cloudReady = false;
    ackSubscribed = false;
    const uint32_t now = millis();
    if (static_cast<int32_t>(now - nextMqttAttemptAt) >= 0) {
      if (mqtt.connect(SHELF_ID)) {
        ackSubscribed = mqtt.subscribe(ACK_TOPIC, 1);
        if (!ackSubscribed) {
          Serial.println("AWS IoT ACK subscription failed");
          mqtt.disconnect();
        }
      }
      nextMqttAttemptAt = millis() + MQTT_RETRY_MS;
    }
  }

  if (mqtt.connected()) mqtt.loop();
  cloudReady = mqtt.connected() && ackSubscribed;
}

void pumpOutbox() {
  if (!hasActiveEvent && xQueueReceive(eventQueue, &activeEvent, 0) == pdTRUE) {
    hasActiveEvent = true;
    waitingForAck = true;
  }
  if (!hasActiveEvent || !cloudReady) return;

  const uint32_t now = millis();
  if (activeEvent.attempted && now - activeEvent.lastAttemptAt < APP_ACK_RETRY_MS) return;
  if (activeEvent.attempted) markDelayed(activeEvent);

  if (!mqtt.publish(EVENT_TOPIC, activeEvent.payload, false)) markDelayed(activeEvent);
  activeEvent.attempted = true;
  activeEvent.lastAttemptAt = now;
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

  bootIdentifier = esp_random();
  eventQueue = xQueueCreate(OUTBOX_CAPACITY, sizeof(QueuedEvent));
  if (!eventQueue) {
    Serial.println("Cannot create shelf event queue");
    while (true) delay(1000);
  }

  projectUuidValid = parseProjectUuid(IBEACON_UUID, projectUuid);
  if (!projectUuidValid) {
    Serial.println("IBEACON_UUID must contain 32 hexadecimal digits");
  }

  WiFi.setAutoReconnect(true);
  tls.setCACert(AWS_ROOT_CA);
  tls.setCertificate(DEVICE_CERTIFICATE);
  tls.setPrivateKey(DEVICE_PRIVATE_KEY);
  mqtt.setServer(AWS_IOT_ENDPOINT, 8883);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(2);
  mqtt.setCallback(onMqttMessage);

  NimBLEDevice::init("SB-SHELF-01");
  bleScan = NimBLEDevice::getScan();
  bleScan->setScanCallbacks(&tagCallbacks, true);
  bleScan->setActiveScan(false);
  bleScan->setInterval(100);
  bleScan->setWindow(65);
  bleScan->start(0, false);

  if (xTaskCreate(sampleShelfInputs, "shelf-inputs", 4096, nullptr, 2, nullptr) != pdPASS) {
    Serial.println("Cannot start shelf input task");
    while (true) delay(1000);
  }
}

void loop() {
  serviceWifi();
  serviceMqtt();
  pumpOutbox();
  delay(5);
}
