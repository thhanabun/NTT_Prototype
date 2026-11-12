import { CAMERA_ID, inRect, metresPerUnit, shelfZone } from "./store-map.mjs";
import { SHELF_IDS } from "./shelves.mjs";

// Rules from docs/basket-detection.md sections 7.6–7.8. Distances are metres on the store map's scale.
const SAME_PERSON_M = 0.75, SAME_TIME_MS = 500;
const RELINK_M = 1, CLOSE_AFTER_MS = 5000;
const TAG_WINDOW_MS = 5000, TAG_MIN_RSSI = -80, TAG_LEAD_DB = 6;
const LINK_AFTER_MS = 3000, UNLINK_CONTRADICTION_MS = 5000, TAG_SILENT_MS = 10000;
const SNAPSHOT_WINDOW_MS = 1500, MAX_SHOPPERS = 50, MAX_SNAPSHOT = 6;
const TAGS = ["A", "B"];

const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function validateTracksMessage(input, map) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tracks message must be an object");
  if (typeof input.cameraId !== "string" || !CAMERA_ID.test(input.cameraId)) throw new Error("Invalid cameraId");
  if (!["LIVE_CAMERA", "TEST_VIDEO"].includes(input.source)) throw new Error("source must be LIVE_CAMERA or TEST_VIDEO");
  if (typeof input.capturedAt !== "string" || !Number.isFinite(Date.parse(input.capturedAt))) throw new Error("Invalid capturedAt");
  if (!Array.isArray(input.tracks) || input.tracks.length > 12) throw new Error("At most 12 tracks per message");
  const tracks = input.tracks.map(track => {
    if (!track || !Number.isInteger(track.trackId) || track.trackId < 1 || track.trackId > 1e9 || !finite(track.confidence, 0, 1) ||
        !Array.isArray(track.box) || track.box.length !== 4 || !track.box.every(v => finite(v, 0, 10000)) || typeof track.occluded !== "boolean") throw new Error("Invalid track");
    if (track.floor !== null && !(track.floor && finite(track.floor.x, 0, map.width) && finite(track.floor.y, 0, map.height))) throw new Error("Track floor position is outside the store map");
    return { trackId: track.trackId, confidence: track.confidence, occluded: track.occluded, floor: track.floor && { x: track.floor.x, y: track.floor.y } };
  });
  return { cameraId: input.cameraId, source: input.source, capturedAt: input.capturedAt, tracks };
}

const median = values => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rectDistance = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));

export function createPresence({ getMap, now = Date.now }) {
  const shoppers = new Map(); // shopperId -> shopper
  const owner = new Map();    // "CAM#track" -> shopperId
  const cameraSeen = new Map(); // cameraId -> last message time
  const heard = new Map(SHELF_IDS.map(id => [id, []])); // shelfId -> [{at, rssi}]
  const tagState = Object.fromEntries(TAGS.map(tag => [tag, { lastHeardAt: null, candidate: null, since: 0, contradictionSince: null }]));
  let sequence = 0;

  const scale = () => metresPerUnit(getMap());
  const distanceM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * scale();

  function shelfOf(point) {
    const map = getMap();
    let best = null;
    for (const shelfId of SHELF_IDS) {
      const zone = shelfZone(map, shelfId);
      if (!zone || !inRect(point, zone)) continue;
      const centre = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
      if (!best || distanceM(point, centre) < best.d) best = { shelfId, d: distanceM(point, centre) };
    }
    return best?.shelfId ?? null;
  }

  function expire(time) {
    for (const [id, shopper] of shoppers) {
      if (time - shopper.lastSeen > CLOSE_AFTER_MS) shoppers.delete(id);
      else for (const [key, seen] of shopper.tracks) if (time - seen.at > CLOSE_AFTER_MS) shopper.tracks.delete(key);
    }
    for (const [key, id] of owner) if (!shoppers.get(id)?.tracks.has(key)) owner.delete(key);
    for (const [cameraId, at] of cameraSeen) if (time - at > 120_000) cameraSeen.delete(cameraId);
  }

  // A shopper already holding a fresh track from this camera is a different person.
  const busyOnCamera = (shopper, cameraId, time) => [...shopper.tracks].some(([key, seen]) => key.startsWith(cameraId + "#") && time - seen.at <= SAME_TIME_MS);

  function findShopperFor(cameraId, floor, time) {
    let best = null;
    for (const shopper of shoppers.values()) {
      if (busyOnCamera(shopper, cameraId, time)) continue;
      const d = distanceM(floor, shopper);
      const seenElsewhere = [...shopper.tracks].some(([key, seen]) => !key.startsWith(cameraId + "#") && time - seen.at <= SAME_TIME_MS);
      const lost = [...shopper.tracks.values()].every(seen => time - seen.at > SAME_TIME_MS);
      if ((seenElsewhere && d <= SAME_PERSON_M) || (lost && d <= RELINK_M)) if (!best || d < best.d) best = { shopper, d };
    }
    return best?.shopper ?? null;
  }

  function linkStep(time) {
    const changes = [];
    const open = [...shoppers.values()];
    for (const tag of TAGS) {
      const state = tagState[tag];
      const zone = tagZone(tag, time);
      const linked = open.find(s => s.tag === tag);
      const unlink = reason => { changes.push({ type: "UNLINKED", tag, shopperId: linked.shopperId, reason }); linked.tag = null; linked.linkedBy = null; };
      if (linked) {
        if (state.lastHeardAt === null || time - state.lastHeardAt > TAG_SILENT_MS) { unlink("TAG_SILENT"); continue; }
        if (linked.linkedBy === "STAFF") continue;
        const contradiction = zone && linked.zone && zone !== linked.zone;
        state.contradictionSince = contradiction ? state.contradictionSince ?? time : null;
        if (contradiction && time - state.contradictionSince >= UNLINK_CONTRADICTION_MS) { unlink("ZONE_CONTRADICTION"); state.contradictionSince = null; }
        continue;
      }
      const there = zone ? open.filter(s => s.zone === zone) : [];
      const alone = there.length === 1 && there[0].tag === null && !there[0].blocked.has(tag) ? there[0] : null;
      if (!alone) { state.candidate = null; continue; }
      if (state.candidate !== alone.shopperId) { state.candidate = alone.shopperId; state.since = time; }
      if (time - state.since >= LINK_AFTER_MS) {
        alone.tag = tag; alone.linkedBy = "PRESENCE"; state.candidate = null;
        changes.push({ type: "LINKED", tag, shopperId: alone.shopperId, reason: `Alone at ${zone} with tag ${tag} for ${LINK_AFTER_MS / 1000} s` });
      }
    }
    return changes;
  }

  function tagZone(tag, time) {
    const strength = [];
    for (const [shelfId, samples] of heard) {
      const values = samples.filter(s => time - s.at <= TAG_WINDOW_MS && Number.isFinite(s.rssi[tag])).map(s => s.rssi[tag]);
      if (values.length) strength.push({ shelfId, rssi: median(values) });
    }
    strength.sort((a, b) => b.rssi - a.rssi);
    const [first, second] = strength;
    return first && first.rssi >= TAG_MIN_RSSI && (!second || first.rssi - second.rssi >= TAG_LEAD_DB) ? first.shelfId : null;
  }

  return {
    ingestTracks(message) {
      const time = now();
      const captured = Date.parse(message.capturedAt);
      const at = Math.abs(captured - time) <= 3000 ? captured : time; // Device clocks may disagree; fall back to receipt time.
      expire(time);
      cameraSeen.set(message.cameraId, time);
      for (const track of message.tracks) {
        if (!track.floor) continue;
        const key = message.cameraId + "#" + track.trackId;
        let shopper = shoppers.get(owner.get(key));
        if (!shopper) {
          if (track.occluded) continue; // New IDs during an overlap wait until the person is clear.
          shopper = findShopperFor(message.cameraId, track.floor, time);
          if (!shopper) {
            if (shoppers.size >= MAX_SHOPPERS) continue;
            shopper = { shopperId: "S-" + String(++sequence).padStart(4, "0"), tag: null, linkedBy: null, blocked: new Set(), tracks: new Map(), x: 0, y: 0 };
            shoppers.set(shopper.shopperId, shopper);
          }
          owner.set(key, shopper.shopperId);
        }
        shopper.tracks.set(key, { at: time, occluded: track.occluded });
        const clearElsewhere = [...shopper.tracks].some(([other, seen]) => other !== key && !seen.occluded && time - seen.at <= SAME_TIME_MS);
        if (!(track.occluded && clearElsewhere)) Object.assign(shopper, { x: track.floor.x, y: track.floor.y, at });
        shopper.lastSeen = time;
        shopper.source = message.source;
        shopper.zone = shelfOf(shopper);
      }
      return linkStep(time);
    },

    ingestTelemetry({ shelfId, receivedAt, rssi = {} }) {
      const time = now();
      if (!heard.has(shelfId)) return [];
      const at = Date.parse(receivedAt) || time;
      const samples = heard.get(shelfId);
      samples.push({ at, rssi });
      while (samples.length > 20 || (samples.length && time - samples[0].at > TAG_WINDOW_MS)) samples.shift();
      for (const tag of TAGS) if (Number.isFinite(rssi[tag])) tagState[tag].lastHeardAt = at;
      expire(time);
      return linkStep(time);
    },

    /** Staff override: set or clear a shopper's tag. It is not undone automatically, except when the tag goes silent. */
    setLink(shopperId, tag) {
      const shopper = shoppers.get(shopperId);
      if (!shopper) throw new Error("Shopper not found or no longer in view");
      if (tag !== null && !TAGS.includes(tag)) throw new Error("tag must be A, B or null");
      const changes = [];
      for (const other of shoppers.values()) if (tag && other !== shopper && other.tag === tag) {
        changes.push({ type: "UNLINKED", tag, shopperId: other.shopperId, reason: "STAFF_MOVED_TAG" }); other.tag = null; other.linkedBy = null;
      }
      if (shopper.tag && shopper.tag !== tag) { changes.push({ type: "UNLINKED", tag: shopper.tag, shopperId, reason: "STAFF" }); shopper.blocked.add(shopper.tag); }
      if (tag) { shopper.blocked.delete(tag); changes.push({ type: "LINKED", tag, shopperId, reason: "STAFF" }); }
      shopper.tag = tag; shopper.linkedBy = tag ? "STAFF" : null;
      return changes;
    },

    expire: () => expire(now()),

    view() {
      const time = now();
      expire(time);
      return {
        at: new Date(time).toISOString(),
        metresPerUnit: scale(),
        cameras: [...cameraSeen.keys()],
        shoppers: [...shoppers.values()].map(s => ({ shopperId: s.shopperId, x: s.x, y: s.y, zone: s.zone, tag: s.tag, linkedBy: s.linkedBy, source: s.source,
          cameras: [...new Set([...s.tracks.keys()].map(key => key.split("#")[0]))], tracks: [...s.tracks.keys()].map(key => ({ cameraId: key.split("#")[0], trackId: Number(key.split("#")[1]) })) })),
        tags: Object.fromEntries(TAGS.map(tag => [tag, { zone: tagZone(tag, time), lastHeardAt: tagState[tag].lastHeardAt && new Date(tagState[tag].lastHeardAt).toISOString() }])),
      };
    },

    /** Who was at this shelf just now, for a shelf event (doc 7.8). */
    snapshotAt(shelfId) {
      const time = now();
      const map = getMap();
      const shape = map.shapes.find(s => s.kind === "shelf" && s.shelfId === shelfId);
      const zone = shelfZone(map, shelfId);
      const recentCamera = [...cameraSeen.values()].some(at => time - at <= SNAPSHOT_WINDOW_MS);
      const base = { at: new Date(time).toISOString(), windowMs: SNAPSHOT_WINDOW_MS, shelfId, cameras: [...cameraSeen].filter(([, at]) => time - at <= SNAPSHOT_WINDOW_MS).map(([id]) => id) };
      if (!shape || !cameraSeen.size) return { status: "NO_CAMERA", ...base, inZone: [] };
      if (!recentCamera) return { status: "STALE", ...base, inZone: [] };
      const inZone = [...shoppers.values()].filter(s => time - s.lastSeen <= SNAPSHOT_WINDOW_MS && inRect(s, zone))
        .map(s => ({ shopperId: s.shopperId, tag: s.tag, linkedBy: s.linkedBy, distanceM: Math.round(rectDistance(s, shape) * scale() * 100) / 100, source: s.source }))
        .sort((a, b) => a.distanceM - b.distanceM).slice(0, MAX_SNAPSHOT);
      return { status: "AVAILABLE", ...base, source: inZone.some(s => s.source === "TEST_VIDEO") ? "TEST_VIDEO" : "LIVE_CAMERA",
        inZone: inZone.map(({ source, ...rest }) => rest) };
    },
  };
}
