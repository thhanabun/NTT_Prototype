#pragma once

// Copy to secrets.h and replace every placeholder. Never commit real keys.
constexpr char WIFI_SSID[] = "YOUR_WIFI_SSID";
constexpr char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
constexpr char AWS_IOT_ENDPOINT[] = "xxxxxxxxxxxx-ats.iot.ap-southeast-1.amazonaws.com";
constexpr char AWS_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
PASTE_AWS_ROOT_CA_HERE
-----END CERTIFICATE-----
)PEM";
constexpr char DEVICE_CERTIFICATE[] = R"PEM(
-----BEGIN CERTIFICATE-----
PASTE_DEVICE_CERTIFICATE_HERE
-----END CERTIFICATE-----
)PEM";
constexpr char DEVICE_PRIVATE_KEY[] = R"PEM(
-----BEGIN RSA PRIVATE KEY-----
PASTE_DEVICE_PRIVATE_KEY_HERE
-----END RSA PRIVATE KEY-----
)PEM";

// Configure all basket tags with this UUID and the matching major/minor values.
constexpr char IBEACON_UUID[] = "A1B2C3D4-E5F6-4A1B-8C2D-1234567890AB";
constexpr uint16_t BASKET_A_MAJOR = 1;
constexpr uint16_t BASKET_A_MINOR = 1;
constexpr uint16_t BASKET_B_MAJOR = 1;
constexpr uint16_t BASKET_B_MINOR = 2;
