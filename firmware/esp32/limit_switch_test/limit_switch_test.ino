#include <Arduino.h>

// One switch: COM -> GND, NO -> GPIO 26; a product must press the lever.
constexpr uint8_t COKE_SWITCH_PIN = 26;
constexpr uint32_t SWITCH_DEBOUNCE_MS = 80;

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
};

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
  Serial.printf("%s %s %s %s\n", lane.laneId, lane.sku,
    present ? "PUT_BACK" : "PICK", present ? "PRESENT" : "EMPTY");
}

void setup() {
  Serial.begin(115200);
  for (Lane& lane : lanes) {
    pinMode(lane.pin, INPUT_PULLUP);
    lane.stablePresent = digitalRead(lane.pin) == LOW;
    lane.candidatePresent = lane.stablePresent;
    lane.candidateSince = millis();
    // Record the starting state without inventing a PICK or PUT_BACK event.
    Serial.printf("%s %s INIT %s\n", lane.laneId, lane.sku,
      lane.stablePresent ? "PRESENT" : "EMPTY");
  }
}

void loop() {
  for (Lane& lane : lanes) sampleLane(lane);
  delay(10);
}
