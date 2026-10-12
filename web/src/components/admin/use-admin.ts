"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getState } from "@/lib/api/client";
import type { ApiState } from "@/lib/api/types";

function validateSnapshot(value: ApiState) {
  if (!value.shelf || !Array.isArray(value.baskets) || !Array.isArray(value.products) ||
      !Array.isArray(value.cases) || !Array.isArray(value.recentEvents)) {
    throw new Error("The server returned an invalid dashboard snapshot.");
  }
  return value;
}

export function useAdmin() {
  const [state, setState] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const next = validateSnapshot(await getState());
      if (request !== generation.current) return false;
      setState(next);
      setStale(false);
      setError("");
      setUpdatedAt(new Date().toISOString());
      return true;
    } catch (cause) {
      if (request !== generation.current) return false;
      setStale(true);
      setError(cause instanceof Error ? cause.message : "Could not load the dashboard.");
      return false;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    void getState().then((value) => {
      if (request !== generation.current) return;
      setState(validateSnapshot(value));
      setUpdatedAt(new Date().toISOString());
    }).catch((cause) => {
      if (request !== generation.current) return;
      setStale(true);
      setError(cause instanceof Error ? cause.message : "Could not load the dashboard.");
    }).finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, []);

  const selectedCase = selectedId ? state?.cases.find((item) => item.caseId === selectedId) ?? null : state?.cases[0] ?? null;
  return { state, loading, stale, error, updatedAt, refresh, selectedCase, selectedId, selectCase: setSelectedId };
}
