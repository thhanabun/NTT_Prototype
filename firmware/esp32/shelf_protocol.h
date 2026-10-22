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

// Largest RSSI history any caller keeps.
constexpr uint8_t SHELF_RSSI_MAX_SAMPLES = 16;

// Sorts the samples newer than maxAgeMs into out[]; returns how many.
inline uint8_t shelfFreshSorted(const int8_t* values, const uint32_t* times, uint8_t count,
                                uint32_t now, uint32_t maxAgeMs, int8_t* out) {
  uint8_t used = 0;
  for (uint8_t i = 0; i < count && i < SHELF_RSSI_MAX_SAMPLES; ++i) {
    if (uint32_t(now - times[i]) <= maxAgeMs) out[used++] = values[i];
  }
  for (uint8_t i = 0; i < used; ++i) for (uint8_t j = i + 1; j < used; ++j) {
    if (out[j] < out[i]) { auto value = out[i]; out[i] = out[j]; out[j] = value; }
  }
  return used;
}

// Median of samples from the last 5 s (shelf pick/put-back evidence).
inline int8_t shelfFreshMedian(const int8_t* values, const uint32_t* times, uint8_t count,
                              uint32_t now, bool& fresh) {
  int8_t samples[SHELF_RSSI_MAX_SAMPLES];
  const uint8_t used = shelfFreshSorted(values, times, count, now, 5000, samples);
  fresh = used > 0;
  return fresh ? samples[used / 2] : 0;
}

// Mean after dropping the highest and lowest quarter of recent samples. Finer than a
// median (fractions of a dB) and still robust to single reflections. Used for positioning.
inline float shelfFreshTrimmedMean(const int8_t* values, const uint32_t* times, uint8_t count,
                                   uint32_t now, uint32_t maxAgeMs, bool& fresh) {
  int8_t samples[SHELF_RSSI_MAX_SAMPLES];
  const uint8_t used = shelfFreshSorted(values, times, count, now, maxAgeMs, samples);
  fresh = used > 0;
  if (!fresh) return 0;
  const uint8_t drop = used >= 4 ? used / 4 : 0;
  int sum = 0;
  for (uint8_t i = drop; i < used - drop; ++i) sum += samples[i];
  return static_cast<float>(sum) / static_cast<float>(used - 2 * drop);
}

// Builds "smartbasket/shelf/<shelfId>/<suffix>". Returns false if it does not fit.
inline bool shelfTopic(char* out, size_t size, const char* shelfId, const char* suffix) {
  const int written = snprintf(out, size, "smartbasket/shelf/%s/%s", shelfId, suffix);
  return written > 0 && static_cast<size_t>(written) < size;
}

struct ShelfBeaconReading {
  bool fresh;
  float rssi;      // trimmed-mean RSSI, valid only when fresh
  uint32_t ageMs;  // time since the last packet, valid only when fresh
};

// RSSI this shelf hears from another shelf ESP32 (its anchor beacon). Used to
// calibrate distance and to place the ESP32s on the map automatically.
struct ShelfAnchorReading {
  uint8_t number;  // other shelf number, e.g. 2 for SHELF-02
  float rssi;      // trimmed-mean RSSI of fresh samples
};

// Every shelf ESP32 advertises an iBeacon with this UUID and major; minor = shelf number.
constexpr uint8_t SHELF_ANCHOR_UUID[16] = {0xBA,0x5C,0x7E,0x70,0x00,0x00,0x40,0x00,0x80,0x00,0x00,0x00,0x00,0x00,0xA0,0xC0};
constexpr uint16_t SHELF_ANCHOR_MAJOR = 0xA5C0;

// "SHELF-03" -> 3. Returns -1 unless the ID ends in 1-255.
inline int shelfIdNumber(const char* shelfId) {
  const char* end = shelfId + strlen(shelfId);
  const char* start = end;
  while (start > shelfId && start[-1] >= '0' && start[-1] <= '9') --start;
  if (start == end || end - start > 3) return -1;
  int value = 0;
  for (const char* cursor = start; cursor < end; ++cursor) value = value * 10 + (*cursor - '0');
  return value >= 1 && value <= 255 ? value : -1;
}

// Apple iBeacon manufacturer data (25 bytes) for this shelf's anchor beacon.
inline void shelfAnchorBeacon(uint8_t out[25], uint16_t minor, int8_t measuredPower) {
  out[0] = 0x4C; out[1] = 0x00; out[2] = 0x02; out[3] = 0x15;
  memcpy(out + 4, SHELF_ANCHOR_UUID, 16);
  out[20] = SHELF_ANCHOR_MAJOR >> 8; out[21] = SHELF_ANCHOR_MAJOR & 0xFF;
  out[22] = minor >> 8; out[23] = minor & 0xFF;
  out[24] = static_cast<uint8_t>(measuredPower);
}

// True and sets minor when the manufacturer data is another shelf's anchor beacon.
inline bool shelfParseAnchorBeacon(const uint8_t* data, size_t length, uint16_t& minor) {
  if (length < 25 || data[0] != 0x4C || data[1] != 0x00 || data[2] != 0x02 || data[3] != 0x15) return false;
  if (memcmp(data + 4, SHELF_ANCHOR_UUID, 16) != 0) return false;
  if (((data[20] << 8) | data[21]) != SHELF_ANCHOR_MAJOR) return false;
  minor = (data[22] << 8) | data[23];
  return true;
}

// Small presence report for the store map. Stale baskets are sent as null;
// only fresh anchor readings are listed.
inline bool shelfPresencePayload(char* out, size_t size, const char* shelfId, uint32_t seq,
                                 uint32_t uptimeMs, const ShelfBeaconReading& a,
                                 const ShelfBeaconReading& b,
                                 const ShelfAnchorReading* anchors = nullptr, uint8_t anchorCount = 0) {
  char rssiA[8] = "null", rssiB[8] = "null", ageA[12] = "null", ageB[12] = "null";
  if (a.fresh) { snprintf(rssiA, sizeof(rssiA), "%.1f", static_cast<double>(a.rssi)); snprintf(ageA, sizeof(ageA), "%lu", static_cast<unsigned long>(a.ageMs)); }
  if (b.fresh) { snprintf(rssiB, sizeof(rssiB), "%.1f", static_cast<double>(b.rssi)); snprintf(ageB, sizeof(ageB), "%lu", static_cast<unsigned long>(b.ageMs)); }
  int written = snprintf(out, size,
    "{\"shelfId\":\"%s\",\"seq\":%lu,\"uptimeMs\":%lu,"
    "\"rssi\":{\"A\":%s,\"B\":%s},\"ageMs\":{\"A\":%s,\"B\":%s},\"anchors\":{",
    shelfId, static_cast<unsigned long>(seq), static_cast<unsigned long>(uptimeMs),
    rssiA, rssiB, ageA, ageB);
  if (written <= 0 || static_cast<size_t>(written) >= size) return false;
  size_t used = static_cast<size_t>(written);
  for (uint8_t i = 0; i < anchorCount; ++i) {
    written = snprintf(out + used, size - used, "%s\"SHELF-%02u\":%.1f", i ? "," : "",
                       static_cast<unsigned>(anchors[i].number), static_cast<double>(anchors[i].rssi));
    if (written <= 0 || static_cast<size_t>(written) >= size - used) return false;
    used += static_cast<size_t>(written);
  }
  written = snprintf(out + used, size - used, "}}");
  return written > 0 && static_cast<size_t>(written) < size - used;
}

inline bool shelfTestCommand(const char* command, uint8_t& lane, const char*& eventType) {
  if (strcmp(command, "pick") == 0 || strcmp(command, "coke_pick") == 0) { lane = 0; eventType = "PICK"; }
  else if (strcmp(command, "put") == 0 || strcmp(command, "coke_put") == 0) { lane = 0; eventType = "PUT_BACK"; }
  else if (strcmp(command, "water_pick") == 0) { lane = 1; eventType = "PICK"; }
  else if (strcmp(command, "water_put") == 0) { lane = 1; eventType = "PUT_BACK"; }
  else return false;
  return true;
}
