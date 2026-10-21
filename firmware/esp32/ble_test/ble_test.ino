#include <Arduino.h>
#include <NimBLEDevice.h>
#include <cmath>

// ============================================================================
// Basketly — DX-CP101 BLE Beacon Test & Distance Monitor
// Standalone diagnostic sketch for ESP32 & DX-CP101 iBeacon cards/tags.
// ============================================================================

constexpr uint32_t SCAN_INTERVAL_MS = 100;
constexpr uint32_t SCAN_WINDOW_MS = 65;
constexpr uint32_t TAG_FRESH_MS = 5000;
constexpr size_t RSSI_WINDOW = 5;
constexpr int CLEAR_MARGIN_DB = 10; // Project policy: 10 dB lead threshold
constexpr size_t MAX_TRACKED_BEACONS = 8;
constexpr uint32_t REPORT_INTERVAL_MS = 1000; // Update & report every 1 second
constexpr uint16_t BLE_ADV_INTERVAL_1S = 1600; // 1600 * 0.625ms = 1000ms

struct BeaconInfo {
  String mac;
  String name;
  bool isIBeacon;
  String uuid;
  uint16_t major;
  uint16_t minor;
  int8_t txPower;
  int8_t lastRssi;
  int8_t rssiHistory[RSSI_WINDOW];
  uint8_t rssiCount;
  uint8_t rssiHead;
  uint32_t lastSeen;
  uint32_t packetsReceived;
};

portMUX_TYPE beaconMux = portMUX_INITIALIZER_UNLOCKED;
BeaconInfo trackedBeacons[MAX_TRACKED_BEACONS];
size_t trackedCount = 0;
NimBLEScan* pBLEScan = nullptr;
uint32_t reportTick = 0;

// Parse Apple iBeacon manufacturer payload
bool parseIBeacon(const uint8_t* data, size_t len, String& uuid, uint16_t& major, uint16_t& minor, int8_t& txPower) {
  if (len < 25) return false;
  if (data[0] != 0x4C || data[1] != 0x00 || data[2] != 0x02 || data[3] != 0x15) {
    return false;
  }

  char uuidBuf[37];
  snprintf(uuidBuf, sizeof(uuidBuf),
    "%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X",
    data[4], data[5], data[6], data[7],
    data[8], data[9],
    data[10], data[11],
    data[12], data[13],
    data[14], data[15], data[16], data[17], data[18], data[19]);
  uuid = String(uuidBuf);

  major = (static_cast<uint16_t>(data[20]) << 8) | data[21];
  minor = (static_cast<uint16_t>(data[22]) << 8) | data[23];
  txPower = static_cast<int8_t>(data[24]);
  return true;
}

// Compute median RSSI for a tracked beacon
int8_t computeMedianRssi(const BeaconInfo& b, bool& isFresh) {
  isFresh = (b.rssiCount > 0) && ((millis() - b.lastSeen) <= TAG_FRESH_MS);
  if (!isFresh || b.rssiCount == 0) return 0;

  int8_t sorted[RSSI_WINDOW];
  for (uint8_t i = 0; i < b.rssiCount; ++i) sorted[i] = b.rssiHistory[i];
  for (uint8_t i = 0; i < b.rssiCount; ++i) {
    for (uint8_t j = i + 1; j < b.rssiCount; ++j) {
      if (sorted[j] < sorted[i]) {
        const int8_t tmp = sorted[i];
        sorted[i] = sorted[j];
        sorted[j] = tmp;
      }
    }
  }
  return sorted[b.rssiCount / 2];
}

// Estimate distance in meters from RSSI & TxPower
float estimateDistance(int8_t rssi, int8_t txPower) {
  if (rssi == 0) return -1.0f;
  // If beacon did not supply calibrated txPower, default to -59 dBm (standard 1m value)
  const int8_t power = (txPower != 0) ? txPower : -59;
  const float ratio = static_cast<float>(power - rssi) / (10.0f * 2.2f);
  return pow(10.0f, ratio);
}

// Text label for proximity zone
const char* getZoneLabel(float dist, int8_t rssi) {
  if (dist < 0.45f || rssi >= -48) return "ใกล้มาก - ชิดชั้นวาง (IMMEDIATE)";
  if (dist < 1.20f || rssi >= -62) return "ระยะหยิบสินค้า - หน้าชั้น (NEAR)";
  if (dist < 2.50f || rssi >= -75) return "ระยะห่าง - ทางเดิน (MID)";
  return "ไกล - นอกระยะหยิบ (FAR)";
}

// Visual signal bar for terminal
String getSignalBar(int8_t rssi) {
  int level = map(constrain(static_cast<int>(rssi), -90, -40), -90, -40, 1, 10);
  String bar = "[";
  for (int i = 0; i < 10; ++i) {
    bar += (i < level) ? "#" : "-";
  }
  bar += "]";
  return bar;
}

class ScanCallbacks final : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) override {
    String mac = device->getAddress().toString().c_str();
    mac.toLowerCase();
    const int8_t rssi = device->getRSSI();
    String name = device->haveName() ? device->getName().c_str() : "";

    bool isIBeacon = false;
    String uuid = "";
    uint16_t major = 0;
    uint16_t minor = 0;
    int8_t txPower = 0;

    if (device->haveManufacturerData()) {
      std::string mfg = device->getManufacturerData();
      isIBeacon = parseIBeacon(reinterpret_cast<const uint8_t*>(mfg.data()), mfg.length(),
                               uuid, major, minor, txPower);
    }

    const bool isDxCp101 = (name.indexOf("DX") >= 0 || name.indexOf("CP101") >= 0 || name.indexOf("Beacon") >= 0);
    if (!isIBeacon && !isDxCp101) {
      return;
    }

    portENTER_CRITICAL(&beaconMux);
    int index = -1;
    for (size_t i = 0; i < trackedCount; ++i) {
      if (trackedBeacons[i].mac == mac) {
        index = static_cast<int>(i);
        break;
      }
    }

    if (index < 0 && trackedCount < MAX_TRACKED_BEACONS) {
      index = static_cast<int>(trackedCount++);
      trackedBeacons[index].mac = mac;
      trackedBeacons[index].name = name;
      trackedBeacons[index].rssiCount = 0;
      trackedBeacons[index].rssiHead = 0;
      trackedBeacons[index].packetsReceived = 0;
    }

    if (index >= 0) {
      BeaconInfo& b = trackedBeacons[index];
      if (name.length() > 0) b.name = name;
      b.isIBeacon = isIBeacon;
      if (isIBeacon) {
        b.uuid = uuid;
        b.major = major;
        b.minor = minor;
        b.txPower = txPower;
      }
      b.lastRssi = rssi;
      b.rssiHistory[b.rssiHead] = rssi;
      b.rssiHead = (b.rssiHead + 1) % RSSI_WINDOW;
      if (b.rssiCount < RSSI_WINDOW) ++b.rssiCount;
      b.lastSeen = millis();
      b.packetsReceived++;
    }
    portEXIT_CRITICAL(&beaconMux);
  }
};

ScanCallbacks scanCallbacks;
uint32_t lastReportTime = 0;

void printBanner() {
  Serial.println("\n==================================================================");
  Serial.println("       Basketly — DX-CP101 BLE Beacon & Distance Monitor          ");
  Serial.println("==================================================================");
  Serial.printf("ESP32 BLE MAC: %s\n", NimBLEDevice::getAddress().toString().c_str());
  Serial.println("BLE Mode     : Dual (Broadcasting 1.0s + Scanning 100% duty)");
  Serial.println("Proximity    : Real-time Distance & Zone Estimation");
  Serial.println("==================================================================\n");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  NimBLEDevice::init("SB-SHELF-01");
  printBanner();

  // 1. BLE Advertising (1 second interval)
  NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->setAdvertisingInterval(BLE_ADV_INTERVAL_1S);
  NimBLEAdvertisementData advData;
  advData.setName("SB-SHELF-01");
  advData.setFlags(0x06);
  pAdvertising->setAdvertisementData(advData);
  pAdvertising->start();

  // 2. BLE Scanning (continuous)
  pBLEScan = NimBLEDevice::getScan();
  pBLEScan->setScanCallbacks(&scanCallbacks, true);
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(SCAN_INTERVAL_MS);
  pBLEScan->setWindow(SCAN_WINDOW_MS);
  pBLEScan->setDuplicateFilter(false);
  pBLEScan->start(0, false);
}

void reportDiagnostics() {
  BeaconInfo snapshot[MAX_TRACKED_BEACONS];
  size_t count = 0;

  portENTER_CRITICAL(&beaconMux);
  count = trackedCount;
  for (size_t i = 0; i < count; ++i) {
    snapshot[i] = trackedBeacons[i];
  }
  portEXIT_CRITICAL(&beaconMux);

  ++reportTick;
  Serial.printf("\n>>> [TICK #%lu | UPTIME %lus] >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n",
                static_cast<unsigned long>(reportTick),
                static_cast<unsigned long>(millis() / 1000));

  if (count == 0) {
    Serial.println("  [Scanning...] No DX-CP101 beacon detected yet.");
    Serial.println("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
    return;
  }

  for (size_t i = 0; i < count; ++i) {
    bool isFresh = false;
    const int8_t medRssi = computeMedianRssi(snapshot[i], isFresh);
    const uint32_t ageMs = millis() - snapshot[i].lastSeen;
    const float dist = estimateDistance(medRssi, snapshot[i].txPower);
    const int distCm = static_cast<int>(round(dist * 100.0f));
    const String sigBar = getSignalBar(medRssi);
    const char* zone = getZoneLabel(dist, medRssi);

    Serial.printf("  [Tag #%u] %s (%s)\n",
                  static_cast<unsigned>(i + 1),
                  snapshot[i].name.length() > 0 ? snapshot[i].name.c_str() : "DX-CP101",
                  snapshot[i].mac.c_str());

    // Highlight Distance clearly
    if (dist >= 0.0f) {
      if (distCm < 100) {
        Serial.printf("    * ระยะทาง (Distance) : ~%d ซม. (%.2f ม.)\n", distCm, dist);
      } else {
        Serial.printf("    * ระยะทาง (Distance) : ~%.2f เมตร (%d ซม.)\n", dist, distCm);
      }
      Serial.printf("    * โซนระยะ (Zone)     : %s\n", zone);
    } else {
      Serial.println("    * ระยะทาง (Distance) : N/A");
    }

    Serial.printf("    * ความแรงสัญญาณ      : %s %d dBm (Raw: %d dBm) | %s (%lums ago)\n",
                  sigBar.c_str(),
                  medRssi,
                  snapshot[i].lastRssi,
                  isFresh ? "FRESH" : "STALE",
                  static_cast<unsigned long>(ageMs));

    if (snapshot[i].isIBeacon) {
      Serial.printf("    * iBeacon Info       : Major: %u | Minor: %u | TxPower: %d dBm\n",
                    snapshot[i].major, snapshot[i].minor, snapshot[i].txPower);
    }
    Serial.println();
  }

  // If 2 or more beacons are found, evaluate which basket is closer
  if (count >= 2) {
    bool fresh0 = false, fresh1 = false;
    const int8_t rssi0 = computeMedianRssi(snapshot[0], fresh0);
    const int8_t rssi1 = computeMedianRssi(snapshot[1], fresh1);

    Serial.println("  --- [การเปรียบเทียบระยะเพื่อตัดสินใจ (Basket Proximity Decision)] ---");
    if (!fresh0 || !fresh1) {
      Serial.println("    ผลลัพธ์: ZONE_UNKNOWN (สัญญาณบางตัวเก่าเกิน 5 วินาที)");
    } else {
      const int diff = abs(rssi0 - rssi1);
      const size_t nearest = (rssi0 > rssi1) ? 0 : 1;
      const size_t farther = (rssi0 > rssi1) ? 1 : 0;
      const float distNear = estimateDistance(computeMedianRssi(snapshot[nearest], fresh0), snapshot[nearest].txPower);
      const float distFar = estimateDistance(computeMedianRssi(snapshot[farther], fresh1), snapshot[farther].txPower);

      Serial.printf("    - ตะกร้าที่ใกล้กว่า : Tag #%u (%s) ห่าง ~%.2f ม. (%d dBm)\n",
                    static_cast<unsigned>(nearest + 1), snapshot[nearest].mac.c_str(), distNear, (nearest == 0 ? rssi0 : rssi1));
      Serial.printf("    - ตะกร้าที่ไกลกว่า  : Tag #%u (%s) ห่าง ~%.2f ม. (%d dBm)\n",
                    static_cast<unsigned>(farther + 1), snapshot[farther].mac.c_str(), distFar, (farther == 0 ? rssi0 : rssi1));
      Serial.printf("    - ผลต่างความแรง (Margin) : %d dB (เกณฑ์ตัดสิน: >= %d dB)\n", diff, CLEAR_MARGIN_DB);

      if (diff >= CLEAR_MARGIN_DB) {
        Serial.printf("    >> ฟันธง: [CONFIRMED CLEAR LEAD] เพิ่มของเข้าตะกร้า Tag #%u อัตโนมัติ!\n",
                      static_cast<unsigned>(nearest + 1));
      } else {
        Serial.println("    >> ก้ำกึ่ง: [AMBIGUOUS ZONE] ต่างกันน้อยกว่า 10 dB -> ส่งถามลูกค้าบนหน้าจอเพื่อยืนยัน");
      }
    }
  }
  Serial.println("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
}

void loop() {
  const uint32_t now = millis();
  if (now - lastReportTime >= REPORT_INTERVAL_MS) {
    lastReportTime = now;
    reportDiagnostics();
  }
  delay(10);
}
