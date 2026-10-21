#pragma once

#include <cstdint>

constexpr int LOW = 0;
constexpr int HIGH = 1;
constexpr uint8_t INPUT_PULLUP = 2;

struct MockSerial {
  void begin(unsigned long baud);
  void printf(const char* format, ...);
};

extern MockSerial Serial;
void pinMode(uint8_t pin, uint8_t mode);
int digitalRead(uint8_t pin);
uint32_t millis();
void delay(uint32_t duration);
