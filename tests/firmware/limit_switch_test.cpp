#include <Arduino.h>
#include <cassert>
#include <cstdarg>
#include <cstdio>
#include <string>
#include <vector>

#include "../../firmware/esp32/limit_switch_test/limit_switch_test.ino"

MockSerial Serial;
uint32_t clockMs = 0;
int pinLevels[40] = {};
uint8_t pinModes[40] = {};
std::vector<std::string> output;

void MockSerial::begin(unsigned long baud) { assert(baud == 115200); }
void MockSerial::printf(const char* format, ...) {
  char line[128];
  va_list args;
  va_start(args, format);
  const int length = vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  assert(length >= 0 && static_cast<size_t>(length) < sizeof(line));
  output.emplace_back(line);
}
void pinMode(uint8_t pin, uint8_t mode) {
  assert(pin == COKE_SWITCH_PIN);
  pinModes[pin] = mode;
}
int digitalRead(uint8_t pin) {
  assert(pin == COKE_SWITCH_PIN);
  return pinLevels[pin];
}
uint32_t millis() { return clockMs; }
void delay(uint32_t duration) { clockMs += duration; }

void sampleAt(uint32_t now) {
  clockMs = now;
  loop();
}

int main() {
  pinLevels[COKE_SWITCH_PIN] = LOW;
  setup();
  assert(pinModes[COKE_SWITCH_PIN] == INPUT_PULLUP);
  assert(output.size() == 1);
  assert(output[0] == "LANE-1 COKE INIT PRESENT\n");
  output.clear();
  sampleAt(100);
  assert(output.empty());

  // A bouncing release must restart the full debounce interval.
  pinLevels[COKE_SWITCH_PIN] = HIGH;
  sampleAt(110);
  pinLevels[COKE_SWITCH_PIN] = LOW;
  sampleAt(130);
  pinLevels[COKE_SWITCH_PIN] = HIGH;
  sampleAt(150);
  sampleAt(229);
  assert(output.empty());
  sampleAt(230);
  assert(output.size() == 1 && output[0] == "LANE-1 COKE PICK EMPTY\n");
  sampleAt(500);
  assert(output.size() == 1);
  output.clear();

  // A short press is ignored; a stable press produces one PUT_BACK.
  pinLevels[COKE_SWITCH_PIN] = LOW;
  sampleAt(510);
  pinLevels[COKE_SWITCH_PIN] = HIGH;
  sampleAt(530);
  sampleAt(590);
  assert(output.empty());
  pinLevels[COKE_SWITCH_PIN] = LOW;
  sampleAt(600);
  sampleAt(679);
  assert(output.empty());
  sampleAt(680);
  assert(output.size() == 1 && output[0] == "LANE-1 COKE PUT_BACK PRESENT\n");
  sampleAt(1000);
  assert(output.size() == 1);
  output.clear();

  // Unsigned elapsed time must still work when millis() wraps around.
  pinLevels[COKE_SWITCH_PIN] = HIGH;
  sampleAt(UINT32_MAX - 30);
  sampleAt(48);
  assert(output.empty());
  sampleAt(49);
  assert(output.size() == 1 && output[0] == "LANE-1 COKE PICK EMPTY\n");
  output.clear();

  // Booting with an empty lane must not invent a PICK event either.
  setup();
  assert(output.size() == 1 && output[0] == "LANE-1 COKE INIT EMPTY\n");
  output.clear();
  sampleAt(200);
  assert(output.empty());
  puts("limit switch checks passed");
}
