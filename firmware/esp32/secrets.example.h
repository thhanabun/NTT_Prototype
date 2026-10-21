#pragma once

// ============================================================================
// Basketly — ESP32 Configuration & Secrets Template
// Copy this file to "secrets.h" in the same folder and customize your values.
// Never commit "secrets.h" to git.
// ============================================================================

// 1. Wi-Fi Configuration
constexpr char WIFI_SSID[] = "YOUR_WIFI_SSID";
constexpr char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";

// 2. Local MQTT Broker & HTTP Backend (Local testing with your laptop)
constexpr char LOCAL_MQTT_HOST[]   = "192.168.100.15"; // Laptop IP on same Wi-Fi
constexpr uint16_t LOCAL_MQTT_PORT = 1883;             // Default MQTT port
constexpr char LOCAL_SERVER_HOST[] = "192.168.100.15";
constexpr uint16_t LOCAL_SERVER_PORT = 3000;

// 3. BLE Beacon MAC Addresses (3 Tags: 2 Baskets + 1 Expensive Product)
// You can discover your beacon MACs using the firmware/esp32/ble_test sketch.
constexpr char BASKET_A_MAC[]       = "48:87:2d:9e:3e:c5"; // Beacon 1 (Basket A): 48872D9E3EC5
constexpr char BASKET_B_MAC[]       = "48:87:2d:9e:3c:0e"; // Beacon 2 (Basket B): 48872D9E3C0E
constexpr char EXPENSIVE_ITEM_MAC[] = "48:87:2d:9e:3e:49"; // Beacon 3 (High-Value): 48872D9E3E49

// 4. AWS IoT Core Configuration (Milestone 3)
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
