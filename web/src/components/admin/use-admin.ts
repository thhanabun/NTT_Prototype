"use client";

import { useRef, useState } from "react";
import { decideStaffCase, resetDemo } from "@/lib/api/client";
import { useLiveState } from "@/lib/api/live-state";
import type { BasketId } from "@/lib/api/types";

export function useAdmin() {
  const live = useLiveState();
  const { state, loading, stale, updatedAt } = live;
  const [actionError, setActionError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
  const error = actionError || live.error;
  async function refresh() {
    setActionError("");
    return live.refresh();
  }

  const selectedCase = selectedId ? state?.cases.find((item) => item.caseId === selectedId) ?? null : state?.cases[0] ?? null;

  async function execute(action: () => Promise<string>) {
    if (locked.current || loading || stale) return;
    locked.current = true;
    setPending(true);
    setActionError("");
    setNotice("");
    try {
      const message = await action();
      if (await refresh()) setNotice(message);
    } catch (cause) {
      await refresh();
      setActionError(cause instanceof Error ? cause.message : "The action failed. Check the latest state before retrying.");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  async function decide(decision: "APPROVE" | "REJECT", target?: BasketId) {
    if (!selectedCase || selectedCase.status !== "OPEN_STAFF" || selectedCase.agent?.status === "RUNNING") return;
    if (decision === "APPROVE" && !target) return;
    const id = selectedCase.caseId;
    return execute(async () => {
      const result = await decideStaffCase(id, decision, target);
      const basket = result.case.resolution?.basketId;
      return `${id} · ${decision}${basket ? ` · Basket ${basket}` : ""} · ตรวจสอบข้อมูลล่าสุดแล้ว`;
    });
  }

  async function reset() {
    return execute(async () => {
      await resetDemo();
      setSelectedId(null);
      return "ล้างข้อมูลแล้ว พร้อมเริ่มใหม่";
    });
  }

  return { state, loading, stale, error, updatedAt, refresh, selectedCase, selectedId,
    connection:live.connection, retryAttempt:live.retryAttempt, pending, notice, execute, decide, reset, selectCase: (id: string) => { if (!locked.current) setSelectedId(id); } };
}
