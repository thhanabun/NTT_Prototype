#pragma once
#include <deque>
#include <vector>
#include <cstring>
struct TestQueue { size_t capacity; size_t itemSize; std::deque<std::vector<char>> items; };
using QueueHandle_t = TestQueue*;
inline QueueHandle_t xQueueCreate(size_t capacity, size_t size) { return new TestQueue{capacity, size, {}}; }
inline int xQueueSend(QueueHandle_t queue, const void* item, unsigned) {
  if (queue->items.size() >= queue->capacity) return 0;
  const auto* bytes = static_cast<const char*>(item);
  queue->items.emplace_back(bytes, bytes + queue->itemSize);
  return 1;
}
inline int xQueueReceive(QueueHandle_t queue, void* item, unsigned) {
  if (queue->items.empty()) return 0;
  memcpy(item, queue->items.front().data(), queue->itemSize);
  queue->items.pop_front();
  return 1;
}
