"use client";

import { useEffect, useRef } from "react";

// Store map and presence updates arrive on their own stream so /api/stream keeps carrying only state snapshots.
type VisionEvent = "store-map" | "presence";
const events = new EventTarget();
let source: EventSource | null = null;
let users = 0;

function open() {
  if (source || typeof EventSource === "undefined" || process.env.NEXT_PUBLIC_CLOUD_MODE === "true") return;
  const stream = new EventSource("/api/vision/stream");
  source = stream;
  for (const name of ["store-map", "presence"] as const) stream.addEventListener(name, event => {
    try { events.dispatchEvent(new MessageEvent(name, { data: JSON.parse((event as MessageEvent<string>).data) })); }
    catch { /* Ignore one malformed message; the next one replaces it. */ }
  });
}

/** Receives store-map / presence updates while mounted. One shared connection per browser tab; EventSource reconnects by itself. */
export function useVisionEvent<T>(name: VisionEvent, handler: (value: T) => void) {
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    const listener = (event: Event) => latest.current((event as MessageEvent<T>).data);
    events.addEventListener(name, listener);
    users++; open();
    return () => {
      events.removeEventListener(name, listener);
      if (--users === 0) { source?.close(); source = null; }
    };
  }, [name]);
}
