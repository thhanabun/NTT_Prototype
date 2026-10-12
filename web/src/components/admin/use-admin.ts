"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decideStaffCase, getState } from "@/lib/api/client";
import type { ApiState, BasketId } from "@/lib/api/types";

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
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
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

  async function execute(action: () => Promise<string>) {
    if (locked.current || loading || stale) return;
    locked.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (await refresh()) setNotice(message);
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : "The action failed. Check the latest state before retrying.");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  async function decide(decision: "APPROVE" | "REJECT", target?: BasketId) {
    if (!selectedCase || selectedCase.status !== "OPEN_STAFF") return;
    if (decision === "APPROVE" && !target) return;
    const id = selectedCase.caseId;
    return execute(async () => {
      const result = await decideStaffCase(id, decision, target);
      const basket = result.case.resolution?.basketId;
      return `${id} · ${decision}${basket ? ` · Basket ${basket}` : ""} · ตรวจสอบข้อมูลล่าสุดแล้ว`;
    });
  }

  return { state, loading, stale, error, updatedAt, refresh, selectedCase, selectedId,
    pending, notice, execute, decide, selectCase: (id: string) => { if (!locked.current) setSelectedId(id); } };
}
