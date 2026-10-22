#include <cassert>
#include <cstdio>
#include <string>
#include <vector>
#include "../../firmware/esp32/shelf_protocol.h"

int main() {
  uint8_t lane;
  const char* type;
  assert(shelfTestCommand("water_pick", lane, type) && lane == 1 && std::string(type) == "PICK");
  assert(shelfTestCommand("water_put", lane, type) && lane == 1 && std::string(type) == "PUT_BACK");
  assert(shelfTestCommand("pick", lane, type) && lane == 0);
  assert(!shelfTestCommand("not-a-pick", lane, type));
  uint8_t packet[25] = {0x4c, 0, 2, 0x15};
  const uint8_t uuid[] = {0xa1,0xb2,0xc3,0xd4,0xe5,0xf6,0x4a,0x1b,0x8c,0x2d,0x12,0x34,0x56,0x78,0x90,0xab};
  memcpy(packet + 4, uuid, 16);
  assert(shelfBeaconUuidMatches(packet, 25, "A1B2C3D4-E5F6-4A1B-8C2D-1234567890AB"));
  assert(!shelfBeaconUuidMatches(packet, 25, ""));
  packet[4] = 0;
  assert(!shelfBeaconUuidMatches(packet, 25, "A1B2C3D4-E5F6-4A1B-8C2D-1234567890AB"));
  int8_t values[] = {-40,-40,-40,-40,-40};
  uint32_t times[] = {1,2,3,4,5};
  bool fresh;
  shelfFreshMedian(values, times, 5, 6000, fresh);
  assert(!fresh);
  values[0] = -85; times[0] = 6000;
  assert(shelfFreshMedian(values, times, 5, 6001, fresh) == -85 && fresh);
  times[0] = UINT32_MAX - 10;
  assert(shelfFreshMedian(values, times, 1, 5, fresh) == -85 && fresh);

  ShelfOutbox outbox;
  assert(outbox.begin());
  outbox.setReady(true);
  const char* payload = "{\"eventId\":\"one\",\"delayed\":false}";
  assert(outbox.enqueue("one", payload, true));
  std::vector<std::string> sent;
  auto publish = [&](const char* id, const char* data) { sent.emplace_back(std::string(id) + ":" + data); return true; };
  outbox.pump(0, publish);
  assert(sent.size() == 1 && outbox.depth() == 1); // MQTT publish never dequeues.
  outbox.acknowledge("other");
  assert(outbox.depth() == 1);
  outbox.pump(2999, publish); assert(sent.size() == 1);
  outbox.pump(3000, publish); assert(sent.size() == 2 && sent.back().find("true ") != std::string::npos);
  outbox.acknowledge("one"); assert(outbox.depth() == 0);
  outbox.acknowledge("one"); assert(outbox.depth() == 0);
  outbox.setReady(false);
  assert(outbox.enqueue("two", payload, false));
  assert(outbox.enqueue("three", payload, false));
  outbox.pump(4000, publish); assert(sent.size() == 2);
  outbox.setReady(true);
  outbox.pump(4001, publish); assert(sent.back().rfind("two:", 0) == 0);
  assert(sent.back().find("true ") != std::string::npos);
  outbox.acknowledge("two");
  outbox.pump(4002, publish); assert(sent.back().rfind("three:", 0) == 0);
  outbox.acknowledge("three"); assert(outbox.depth() == 0);
  for (int i=0;i<8;++i) assert(outbox.enqueue(std::to_string(i).c_str(), payload, true));
  assert(!outbox.enqueue("overflow", payload, true) && outbox.dropped() == 1);
  assert(outbox.depth() == 8);
  outbox.pump(5000, [](const char*, const char*) { return false; });
  assert(outbox.depth() == 8);
  char topic[64];
  assert(shelfTopic(topic, sizeof(topic), "SHELF-02", "presence"));
  assert(std::string(topic) == "smartbasket/shelf/SHELF-02/presence");
  char tinyTopic[12];
  assert(!shelfTopic(tinyTopic, sizeof(tinyTopic), "SHELF-02", "presence"));

  char presence[192];
  ShelfBeaconReading seenA{true, -55, 120};
  ShelfBeaconReading staleB{false, 0, 0};
  assert(shelfPresencePayload(presence, sizeof(presence), "SHELF-01", 42, 123456, seenA, staleB));
  assert(std::string(presence) ==
    "{\"shelfId\":\"SHELF-01\",\"seq\":42,\"uptimeMs\":123456,"
    "\"rssi\":{\"A\":-55,\"B\":null},\"ageMs\":{\"A\":120,\"B\":null},\"anchors\":{}}");
  char tinyPresence[16];
  assert(!shelfPresencePayload(tinyPresence, sizeof(tinyPresence), "SHELF-01", 1, 1, seenA, staleB));

  ShelfAnchorReading heard[] = {{2, -61}, {3, -74}};
  assert(shelfPresencePayload(presence, sizeof(presence), "SHELF-01", 7, 9, seenA, staleB, heard, 2));
  assert(std::string(presence).find("\"anchors\":{\"SHELF-02\":-61,\"SHELF-03\":-74}}") != std::string::npos);
  char shortPresence[120];
  assert(!shelfPresencePayload(shortPresence, sizeof(shortPresence), "SHELF-01", 7, 9, seenA, staleB, heard, 2));

  assert(shelfIdNumber("SHELF-03") == 3 && shelfIdNumber("SHELF-12") == 12);
  assert(shelfIdNumber("SHELF") == -1 && shelfIdNumber("SHELF-00") == -1 && shelfIdNumber("SHELF-1000") == -1);

  uint8_t anchor[25];
  shelfAnchorBeacon(anchor, 3, -59);
  uint16_t minor = 0;
  assert(shelfParseAnchorBeacon(anchor, sizeof(anchor), minor) && minor == 3);
  assert(static_cast<int8_t>(anchor[24]) == -59);
  anchor[21] ^= 1;
  assert(!shelfParseAnchorBeacon(anchor, sizeof(anchor), minor)); // wrong major
  anchor[21] ^= 1; anchor[10] ^= 1;
  assert(!shelfParseAnchorBeacon(anchor, sizeof(anchor), minor)); // wrong UUID

  puts("protocol checks passed: exact water commands, UUID, per-sample freshness, ACK-only FIFO, retry/delayed, overflow, topics, presence payload, anchor beacons");
}
