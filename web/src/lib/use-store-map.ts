"use client";

import { useCallback, useEffect, useState } from "react";
import { getStoreMap } from "@/lib/api/client";
import { useVisionEvent } from "@/lib/api/vision-stream";
import type { StoreMap } from "@/lib/api/types";

/** The shared store map: loaded once, then kept current from the server's live "store-map" event. */
export function useStoreMap() {
  const [map, setMap] = useState<StoreMap | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => getStoreMap().then(value => { setMap(value); setError(""); })
    .catch(cause => setError(cause instanceof Error ? cause.message : "โหลดแผนที่ร้านไม่สำเร็จ")), []);
  useEffect(() => { void reload(); }, [reload]);
  useVisionEvent<StoreMap>("store-map", setMap);
  return { map, setMap, error, reload };
}
