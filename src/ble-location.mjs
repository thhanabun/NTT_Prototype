import { BLE_LOCATION_CONFIG } from "./ble-location-config.mjs";
import { DEVICE_TIMEOUT_MS } from "./device-state.mjs";
import { SHELF_IDS } from "./shelves.mjs";

export const BLE_TAG_IDS = ["A", "B", "HV01"];
const MAX_SAMPLE_SKEW_MS = 2000;
const MAX_CONSECUTIVE_GAP_MS = 2500;
const ENTER_WINDOWS = 2;
const EXIT_WINDOWS = 3;
const FINGERPRINT_NEIGHBORS = 3;

function validRssi(value) {
  return Number.isFinite(value) && value >= -127 && value <= 0;
}

function tagConfig(config, tagId) {
  return config.tags?.[tagId] || {};
}

function thresholdsReady(config) {
  return validRssi(config.enterRssiDbm) && validRssi(config.exitRssiDbm) && config.exitRssiDbm < config.enterRssiDbm;
}

function fingerprints(config) {
  if (!Array.isArray(config.fingerprints)) return [];
  return config.fingerprints.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
    (point.zone === undefined || typeof point.zone === "string") &&
    SHELF_IDS.every(shelfId => validRssi(point?.rssi?.[shelfId])));
}

function latestDeviceSamples(store) {
  const latest = new Map();
  for (const sample of store.telemetry || []) {
    if (sample.source !== "DEVICE" || !SHELF_IDS.includes(sample.shelfId)) continue;
    const at = Date.parse(sample.receivedAt);
    const previousAt = latest.has(sample.shelfId) ? Date.parse(latest.get(sample.shelfId).receivedAt) : -Infinity;
    if (!Number.isFinite(at) || at <= previousAt) continue;
    latest.set(sample.shelfId, sample);
  }
  return latest;
}

function tagReadings(store, tagId, now) {
  const latest = latestDeviceSamples(store);
  const rssi = {}, sampleTimes = [], signalTimes = [];
  let lastSeenAt = null;
  for (const shelfId of SHELF_IDS) {
    const sample = latest.get(shelfId);
    const at = sample ? Date.parse(sample.receivedAt) : NaN;
    const value = sample?.rssi?.[tagId];
    const fresh = Number.isFinite(at) && Math.max(0, now - at) <= DEVICE_TIMEOUT_MS;
    if (fresh) sampleTimes.push(at);
    if (validRssi(value)) {
      if (!lastSeenAt || at > Date.parse(lastSeenAt)) lastSeenAt = sample.receivedAt;
      rssi[shelfId] = fresh ? value : null;
      if (fresh) signalTimes.push(at);
    } else rssi[shelfId] = null;
  }
  const freshCount = signalTimes.length;
  const aligned = sampleTimes.length === SHELF_IDS.length && Math.max(...sampleTimes) - Math.min(...sampleTimes) <= MAX_SAMPLE_SKEW_MS;
  const positionReady = aligned && freshCount === SHELF_IDS.length;
  return { rssi, sampleTimes, readerCount: sampleTimes.length, freshCount, aligned, positionReady, lastSeenAt };
}

function locate(rssi, points) {
  if (!points.length) return null;
  const nearest = points.map(point => ({
    point,
    distance: Math.sqrt(SHELF_IDS.reduce((sum, shelfId) => sum + (rssi[shelfId] - point.rssi[shelfId]) ** 2, 0)),
  })).sort((a, b) => a.distance - b.distance).slice(0, FINGERPRINT_NEIGHBORS);
  if (!nearest.length) return null;
  if (nearest[0].distance === 0) {
    const { x, y, zone = null } = nearest[0].point;
    return { x, y, zone };
  }
  const weighted = nearest.map(item => ({ ...item, weight: 1 / item.distance }));
  const weight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const zone = weighted.filter(item => item.point.zone).sort((a, b) => b.weight - a.weight)[0]?.point.zone || null;
  return {
    x: weighted.reduce((sum, item) => sum + item.point.x * item.weight, 0) / weight,
    y: weighted.reduce((sum, item) => sum + item.point.y * item.weight, 0) / weight,
    zone,
  };
}

export function updateBleLocation(store, now = Date.now(), config = BLE_LOCATION_CONFIG) {
  store.bleLocationState ||= {};
  for (const tagId of BLE_TAG_IDS) {
    const settings = tagConfig(config, tagId);
    if (!thresholdsReady(settings)) continue;
    const readings = tagReadings(store, tagId, now);
    if (!readings.aligned) continue;
    const at = Math.max(...readings.sampleTimes);
    const window = Math.floor(at / 1000);
    const state = store.bleLocationState[tagId] ||= { presence: "UNKNOWN", enterCount: 0, exitCount: 0, lastWindow: null, lastWindowAt: null };
    if (state.lastWindow !== null && window <= state.lastWindow) continue;
    if (state.lastWindowAt !== null && at - state.lastWindowAt > MAX_CONSECUTIVE_GAP_MS) {
      state.enterCount = 0;
      state.exitCount = 0;
    }
    state.lastWindow = window;
    state.lastWindowAt = at;
    const values = SHELF_IDS.map(shelfId => readings.rssi[shelfId]);
    if (values.some(value => value !== null && value >= settings.enterRssiDbm)) {
      state.enterCount += 1;
      state.exitCount = 0;
      if (state.enterCount >= ENTER_WINDOWS) state.presence = "INSIDE";
    } else if (values.every(value => value === null || value <= settings.exitRssiDbm)) {
      state.exitCount += 1;
      state.enterCount = 0;
      if (state.exitCount >= EXIT_WINDOWS) state.presence = "OUTSIDE";
    } else {
      state.enterCount = 0;
      state.exitCount = 0;
    }
  }
}

export function bleLocations(store, now = Date.now(), config = BLE_LOCATION_CONFIG) {
  return BLE_TAG_IDS.map(tagId => {
    const settings = tagConfig(config, tagId);
    const points = fingerprints(settings);
    const configured = thresholdsReady(settings);
    const readings = tagReadings(store, tagId, now);
    const state = store.bleLocationState?.[tagId];
    const presence = !configured ? "UNCONFIGURED" : !readings.aligned
      ? readings.freshCount ? "PARTIAL" : "UNKNOWN"
      : state?.presence || "UNKNOWN";
    const canLocate = readings.positionReady && points.length && (!configured || presence === "INSIDE");
    const estimate = canLocate ? locate(readings.rssi, points) : null;
    const status = estimate ? "TRACKING" : !points.length ? "UNCALIBRATED"
      : presence === "OUTSIDE" ? "OUTSIDE"
        : !readings.aligned ? readings.readerCount === 0 ? "STALE" : "PARTIAL"
          : presence === "INSIDE" && !readings.positionReady ? "PARTIAL" : "WAITING";
    const strongest = SHELF_IDS.filter(shelfId => readings.rssi[shelfId] !== null)
      .sort((a, b) => readings.rssi[b] - readings.rssi[a])[0] || null;
    return {
      tagId,
      status,
      presence,
      x: estimate?.x ?? null,
      y: estimate?.y ?? null,
      zone: estimate?.zone ?? null,
      nearestReaderId: strongest,
      rssi: readings.rssi,
      lastSeenAt: readings.lastSeenAt,
    };
  });
}
