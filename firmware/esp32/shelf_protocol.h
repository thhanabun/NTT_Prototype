#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// Shared by local/AWS sketches: an MQTT write is not an application ACK.
class ShelfOutbox {
public:
  struct Event {
    char id[48] = {};
    char payload[384] = {};
    uint32_t lastAttempt = 0;
    bool attempted = false;
  };
  bool begin() { queue = xQueueCreate(8, sizeof(Event)); return queue != nullptr; }
  uint8_t depth() { portENTER_CRITICAL(&mux); auto value = pending; portEXIT_CRITICAL(&mux); return value; }
  uint32_t dropped() { portENTER_CRITICAL(&mux); auto value = droppedCount; portEXIT_CRITICAL(&mux); return value; }
  void setReady(bool value) { ready = value; }
  bool isReady() const { return ready; }
  bool enqueue(const char* id, const char* payload, bool networkAvailable) {
    Event event;
    if (strlen(id) >= sizeof(event.id) || strlen(payload) >= sizeof(event.payload)) return false;
    strcpy(event.id, id);
    strcpy(event.payload, payload);
    portENTER_CRITICAL(&mux);
    if (pending >= 8) { ++droppedCount; portEXIT_CRITICAL(&mux); return false; }
    bool delayed = !networkAvailable || !ready || pending > 0;
    ++pending;
    portEXIT_CRITICAL(&mux);
    if (delayed) markDelayed(event);
    if (xQueueSend(queue, &event, 0) == pdTRUE) return true;
    portENTER_CRITICAL(&mux); --pending; ++droppedCount; portEXIT_CRITICAL(&mux);
    return false;
  }
  void acknowledge(const char* id) {
    if (!hasActive || strcmp(active.id, id) != 0) return;
    hasActive = false;
    portENTER_CRITICAL(&mux); --pending; portEXIT_CRITICAL(&mux);
  }
  template <typename Publish>
  void pump(uint32_t now, Publish publish) {
    if (!hasActive && xQueueReceive(queue, &active, 0) == pdTRUE) hasActive = true;
    if (!hasActive) return;
    if (!ready) { markDelayed(active); return; }
    if (active.attempted && uint32_t(now - active.lastAttempt) < 3000) return;
    if (active.attempted) markDelayed(active);
    active.attempted = true;
    active.lastAttempt = now;
    if (!publish(active.id, active.payload)) markDelayed(active);
  }
private:
  static void markDelayed(Event& event) {
    char* flag = strstr(event.payload, "\"delayed\":false");
    if (flag) memcpy(flag + 10, "true ", 5);
  }
  QueueHandle_t queue = nullptr;
  Event active;
  bool hasActive = false;
  volatile bool ready = false;
  uint8_t pending = 0;
  uint32_t droppedCount = 0;
  portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
};

inline bool shelfBeaconUuidMatches(const uint8_t* bytes, size_t length, const char* uuid) {
  if (length < 25 || bytes[0] != 0x4c || bytes[1] != 0 || bytes[2] != 2 || bytes[3] != 0x15) return false;
  uint8_t decoded[16] = {};
  size_t count = 0;
  int high = -1;
  for (const char* cursor = uuid; *cursor; ++cursor) {
    if (*cursor == '-') continue;
    int value = *cursor >= '0' && *cursor <= '9' ? *cursor - '0'
      : *cursor >= 'a' && *cursor <= 'f' ? *cursor - 'a' + 10
      : *cursor >= 'A' && *cursor <= 'F' ? *cursor - 'A' + 10 : -1;
    if (value < 0) return false;
    if (high < 0) high = value;
    else { if (count >= 16) return false; decoded[count++] = (high << 4) | value; high = -1; }
  }
  return count == 16 && high < 0 && memcmp(bytes + 4, decoded, 16) == 0;
}

inline int8_t shelfFreshMedian(const int8_t* values, const uint32_t* times, uint8_t count,
                              uint32_t now, bool& fresh) {
  int8_t samples[5];
  uint8_t used = 0;
  for (uint8_t i = 0; i < count && i < 5; ++i) {
    if (uint32_t(now - times[i]) <= 5000) samples[used++] = values[i];
  }
  fresh = used > 0;
  if (!fresh) return 0;
  for (uint8_t i = 0; i < used; ++i) for (uint8_t j = i + 1; j < used; ++j) {
    if (samples[j] < samples[i]) { auto value = samples[i]; samples[i] = samples[j]; samples[j] = value; }
  }
  return samples[used / 2];
}

// Builds "smartbasket/shelf/<shelfId>/<suffix>". Returns false if it does not fit.
inline bool shelfTopic(char* out, size_t size, const char* shelfId, const char* suffix) {
  const int written = snprintf(out, size, "smartbasket/shelf/%s/%s", shelfId, suffix);
  return written > 0 && static_cast<size_t>(written) < size;
}

struct ShelfBeaconReading {
  bool fresh;
  int8_t rssi;     // median RSSI, valid only when fresh
  uint32_t ageMs;  // time since the last packet, valid only when fresh
};

// Small presence report for the store map. Stale baskets are sent as null.
inline bool shelfPresencePayload(char* out, size_t size, const char* shelfId, uint32_t seq,
                                 uint32_t uptimeMs, const ShelfBeaconReading& a,
                                 const ShelfBeaconReading& b) {
  char rssiA[8] = "null", rssiB[8] = "null", ageA[12] = "null", ageB[12] = "null";
  if (a.fresh) { snprintf(rssiA, sizeof(rssiA), "%d", a.rssi); snprintf(ageA, sizeof(ageA), "%lu", static_cast<unsigned long>(a.ageMs)); }
  if (b.fresh) { snprintf(rssiB, sizeof(rssiB), "%d", b.rssi); snprintf(ageB, sizeof(ageB), "%lu", static_cast<unsigned long>(b.ageMs)); }
  const int written = snprintf(out, size,
    "{\"shelfId\":\"%s\",\"seq\":%lu,\"uptimeMs\":%lu,"
    "\"rssi\":{\"A\":%s,\"B\":%s},\"ageMs\":{\"A\":%s,\"B\":%s}}",
    shelfId, static_cast<unsigned long>(seq), static_cast<unsigned long>(uptimeMs),
    rssiA, rssiB, ageA, ageB);
  return written > 0 && static_cast<size_t>(written) < size;
}

inline bool shelfTestCommand(const char* command, uint8_t& lane, const char*& eventType) {
  if (strcmp(command, "pick") == 0 || strcmp(command, "coke_pick") == 0) { lane = 0; eventType = "PICK"; }
  else if (strcmp(command, "put") == 0 || strcmp(command, "coke_put") == 0) { lane = 0; eventType = "PUT_BACK"; }
  else if (strcmp(command, "water_pick") == 0) { lane = 1; eventType = "PICK"; }
  else if (strcmp(command, "water_put") == 0) { lane = 1; eventType = "PUT_BACK"; }
  else return false;
  return true;
}
