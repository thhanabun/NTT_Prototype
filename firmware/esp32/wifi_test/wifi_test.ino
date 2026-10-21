#include <Arduino.h>
#include <WiFi.h>
#include <cassert>
#include <cstring>
#include "secrets.h"

constexpr uint32_t WIFI_TIMEOUT_MS = 15000;

void setup() {
  Serial.begin(115200);
  delay(1000);
  if (WIFI_SSID[0] == '\0' || strcmp(WIFI_SSID, "YOUR_WIFI_SSID") == 0 ||
      strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0) {
    Serial.println("Set WIFI_SSID and WIFI_PASSWORD in secrets.h, then upload again.");
    return;
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_TIMEOUT_MS) {
    delay(250);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("Wi-Fi connection timed out; status=%d. Check credentials and 2.4 GHz signal.\n",
      static_cast<int>(WiFi.status()));
    return;
  }

  // A connected station must have a usable DHCP address before cloud tests.
  assert(static_cast<uint32_t>(WiFi.localIP()) != 0);
  Serial.println("Wi-Fi connected");
  Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("RSSI: %ld dBm\n", static_cast<long>(WiFi.RSSI()));
}

void loop() {
  delay(1000);
}
