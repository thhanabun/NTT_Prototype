"use client";

import { useSyncExternalStore } from "react";
import { getPresence, getState } from "./client";
import type { ApiState, PresenceSnapshot } from "./types";

export type Connection = "connecting" | "live" | "reconnecting" | "offline" | "manual";
interface LiveSnapshot {
  state: ApiState | null;
  loading: boolean;
  stale: boolean;
  error: string;
  updatedAt: string | null;
  connection: Connection;
  retryAttempt: number;
  // Store-map presence. Optional: the map waits while it is null.
  presence: PresenceSnapshot | null;
}
const initial: LiveSnapshot = { state:null, loading:true, stale:true, error:"", updatedAt:null, connection:"connecting", retryAttempt:0, presence:null };
let snapshot = initial;
const listeners = new Set<() => void>();
const delays = [1500, 3000, 6000, 12000, 30000];
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let cleanup: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;
let requestNumber = 0;
let streamRevision = 0;
let presenceRevision = 0;
let active = false;

function validPresence(value: PresenceSnapshot): PresenceSnapshot | null {
  return value && Array.isArray(value.baskets) && Array.isArray(value.shelves) ? value : null;
}

function validate(value: ApiState): ApiState {
  if (!value || !value.shelf?.rssi || !Array.isArray(value.products) || !Array.isArray(value.baskets) ||
      !Array.isArray(value.cases) || !Array.isArray(value.recentEvents) || !Array.isArray(value.recentOrders)) {
    throw new Error("The server returned an invalid state snapshot.");
  }
  return value;
}
function update(changes: Partial<LiveSnapshot>) {
  snapshot = { ...snapshot, ...changes };
  listeners.forEach(listener => listener());
}
function accept(value: ApiState) {
  update({ state:validate(value), loading:false, stale:false, error:"", updatedAt:new Date().toISOString() });
}
function disconnect() {
  source?.close();
  source = null;
  clearTimeout(retry);
  retry = undefined;
}
function retryConnection(message: string) {
  disconnect();
  if (!active) return;
  const attempt = snapshot.retryAttempt;
  if (attempt >= delays.length) {
    update({connection:"offline", stale:true, loading:false, error:`${message} กดเชื่อมต่อใหม่เพื่อลองอีกครั้ง`});
    return;
  }
  update({connection:"reconnecting", retryAttempt:attempt+1, stale:true, loading:false, error:message});
  retry = setTimeout(connect, delays[attempt]);
}
function connect() {
  disconnect();
  if (!active) return;
  if (typeof EventSource === "undefined") {
    update({connection:"manual"});
    return;
  }
  try {
    const stream = new EventSource("/api/stream");
    source = stream;
    stream.addEventListener("state", event => {
      if (!active || source !== stream) return;
      try {
        const next = validate(JSON.parse((event as MessageEvent<string>).data));
        streamRevision += 1;
        accept(next);
        update({connection:"live", retryAttempt:0});
      } catch {
        retryConnection("อ่านข้อมูล realtime ไม่สำเร็จ ข้อมูลที่แสดงอาจเก่า");
      }
    });
    stream.addEventListener("presence", event => {
      if (!active || source !== stream) return;
      try {
        const next = validPresence(JSON.parse((event as MessageEvent<string>).data));
        if (next) { presenceRevision += 1; update({presence:next}); }
      } catch { /* A bad presence message never breaks cart state. */ }
    });
    stream.onerror = () => {
      if (source === stream) retryConnection("การเชื่อมต่อ realtime ขาดหาย กำลังลองเชื่อมต่อใหม่");
    };
  } catch {
    retryConnection("เปิดการเชื่อมต่อ realtime ไม่สำเร็จ");
  }
}

async function readState(showLoading: boolean): Promise<boolean> {
  const number = ++requestNumber;
  const revision = streamRevision;
  controller?.abort();
  const request = new AbortController();
  controller = request;
  if (showLoading) update({loading:true});
  // Presence is optional and best-effort: an older backend without /api/presence is fine.
  const presenceAtStart = presenceRevision;
  void getPresence(request.signal).then(value => {
    const next = validPresence(value);
    if (next && active && presenceAtStart === presenceRevision) update({presence:next});
  }).catch(() => {});
  try {
    const next = validate(await getState(AbortSignal.any([request.signal, AbortSignal.timeout(12_000)])));
    if (!active || number !== requestNumber) return false;
    // A stream snapshot received after this GET began is newer than this response.
    if (revision === streamRevision) {
      accept(next);
      if (snapshot.connection !== "live" && snapshot.connection !== "manual") update({stale:true});
    }
    return !snapshot.stale;
  } catch (cause) {
    if (!active || number !== requestNumber) return false;
    if (revision === streamRevision) update({stale:true, error:cause instanceof Error ? cause.message : "Could not load state."});
    return false;
  } finally {
    if (active && number === requestNumber) update({loading:false});
  }
}

export async function refreshLiveState(): Promise<boolean> {
  if (!active) return false;
  if (snapshot.connection === "offline" || snapshot.connection === "reconnecting") {
    update({connection:"connecting", retryAttempt:0});
    connect();
  }
  return readState(true);
}
function stop() {
  active = false;
  requestNumber += 1;
  controller?.abort();
  controller = null;
  disconnect();
  snapshot = { ...snapshot, stale:true, loading:true, connection:"connecting", retryAttempt:0 };
}
function subscribe(listener: () => void) {
  clearTimeout(cleanup);
  listeners.add(listener);
  if (!active) {
    active = true;
    connect();
    void readState(false);
  }
  return () => {
    listeners.delete(listener);
    // Keep one connection through React Strict Mode's immediate resubscription.
    if (!listeners.size) cleanup = setTimeout(stop, 0);
  };
}
const getSnapshot = () => snapshot;
const getServerSnapshot = () => initial;

export function useLiveState() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...value, refresh:refreshLiveState };
}
