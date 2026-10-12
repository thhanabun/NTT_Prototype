"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getState, startSession } from "@/lib/api/client";
import type { ApiState, Basket, BasketId } from "@/lib/api/types";

const storageKey = "basketly-basket";
export function useShopper() {
  const [state, setState] = useState<ApiState | null>(null);
  const [basketId, setBasketId] = useState<BasketId>("A");
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await getState();
      if (request !== generation.current) return false;
      if (!Array.isArray(next.baskets) || !Array.isArray(next.products) || !Array.isArray(next.cases)) {
        throw new Error("The server returned an invalid basket snapshot.");
      }
      setState(next);
      setError("");
      setStale(false);
      return true;
    } catch (cause) {
      if (request !== generation.current) return false;
      setError(cause instanceof Error ? cause.message : "Could not load the basket.");
      setStale(true);
      return false;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("basket");
    let saved: string | null = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
    const selected = query === "A" || query === "B" ? query : saved;
    const request = ++generation.current;
    void getState().then((next) => {
      if (request !== generation.current) return;
      if (!Array.isArray(next.baskets) || !Array.isArray(next.products) || !Array.isArray(next.cases)) {
        throw new Error("The server returned an invalid basket snapshot.");
      }
      setState(next);
      if (selected === "A" || selected === "B") setBasketId(selected);
    }).catch((cause) => {
      if (request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load the basket.");
      setStale(true);
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
    return () => { generation.current += 1; };
  }, []);

  function selectBasket(id: BasketId) {
    if (locked.current) return;
    setBasketId(id);
    setNotice("");
    const url = new URL(window.location.href);
    url.searchParams.set("basket", id);
    window.history.replaceState(null, "", url);
    try { localStorage.setItem(storageKey, id); } catch { /* Selection still works without storage. */ }
  }

  async function beginSession() {
    if (locked.current || loading || stale) return;
    locked.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await startSession(basketId);
      if (await refresh()) setNotice(`Basket ${basketId} พร้อมสำหรับการช้อปแล้ว`);
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : "Could not start the session.");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  const basket: Basket = state?.baskets.find((item) => item.basketId === basketId) ?? {
    basketId, session: null, lines: [], total: 0, payable: false, unresolvedCaseCount: 0,
  };

  return { state, basket, basketId, loading, stale, error, notice, pending, refresh, selectBasket, beginSession };
}
