# BLE location setup

The three ESP32 shelves are fixed receivers. Basket A, Basket B and HV-001 are the moving BLE tags. Each receiver already publishes a five-sample RSSI median at about 1 Hz; this feature reuses those readings.

> **Status as of 17 Nov 2026:** This is an optional RSSI-fingerprinting experiment. The active basket/FSM policy uses RSSI as zone evidence only; these estimated coordinates do not assign cart ownership or authorize payment. No physical location-accuracy result has been measured. For the separate recorded-camera map, see [customer detection](customer-detection.md).

## Configure calibration

Edit `src/ble-location-config.mjs` after installing the receivers. Set thresholds separately for each tag because their transmit power and mounting can differ:

- `enterRssiDbm`: measured RSSI at which the tag should enter the monitored area.
- `exitRssiDbm`: a weaker RSSI than the enter threshold. The gap holds the current state while RSSI fluctuates.
- `fingerprints`: surveyed map points, each with `x` and `y` in meters, an optional `zone`, and the RSSI seen by all three shelf IDs.

Example fingerprint shape (RSSI numbers are illustrative; replace them with measurements from the installed room):

```js
{
  x: 1,
  y: 2,
  zone: "center",
  rssi: { "SHELF-01": -60, "SHELF-02": -78, "SHELF-03": -83 },
}
```

Take a median for each receiver at each point. Collect a separate fingerprint set for each tag at its normal mounting height and orientation. The estimator compares the live three-reader vector to the nearest three surveyed vectors and returns a weighted coordinate. It withholds coordinates if fewer than three fresh, time-aligned tag readings are available.

## Calibrate and verify

1. Mark a floor-map origin and measure the three fixed reader locations. Keep the readers powered, mounted, and oriented the same way during survey and operation.
2. Walk the intended tag path. At each reference point, collect stable telemetry for about 1–2 minutes and record the actual `x`, `y`, zone, tag ID, and the three RSSI values.
3. Walk into and out of the boundary to choose each tag's enter/exit thresholds. Entry requires a strong reading from any reader for two consecutive windows. Exit requires all three receivers to be online and either report a weak reading or no tag sighting for three consecutive windows. Windows with missing receiver telemetry do not count.
4. Put the tag at test points that were not used for calibration. Compare estimated and measured positions. Add samples or move readers if the error is too high.

In the default configuration all thresholds and fingerprint lists are empty. The Admin panel shows `ยังไม่ปรับเทียบ` and no coordinates until measured values are added. Restart the API after editing the config. Local firmware sketches for Shelf 1–3 are in `firmware/esp32/local_shelf`, `local_shelf_02`, and `local_shelf_03`. For AWS, run one IoT bridge process per shelf ID.

RSSI fingerprinting provides an estimate, not an exact coordinate guarantee. The actual error depends on the room, obstructions, people, tag orientation, and receiver placement.
