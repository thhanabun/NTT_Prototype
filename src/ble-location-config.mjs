const uncalibrated = () => ({ enterRssiDbm: null, exitRssiDbm: null, fingerprints: [] });

export const BLE_LOCATION_CONFIG = {
  tags: {
    A: uncalibrated(),
    B: uncalibrated(),
    HV01: uncalibrated(),
  },
};
