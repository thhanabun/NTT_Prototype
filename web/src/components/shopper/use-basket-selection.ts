"use client";

import { useSyncExternalStore } from "react";
import type { BasketId } from "@/lib/api/types";

const eventName = "basketly-selection";
function getSelection(): BasketId {
  const query = new URLSearchParams(window.location.search).get("basket");
  if (query === "A" || query === "B") return query;
  try { return localStorage.getItem("basketly-basket") === "B" ? "B" : "A"; } catch { return "A"; }
}
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener("popstate", listener);
  return () => { window.removeEventListener(eventName, listener); window.removeEventListener("popstate", listener); };
}
export function useBasketSelection() {
  const basketId = useSyncExternalStore(subscribe, getSelection, () => "A" as BasketId);
  function select(id: BasketId) {
    const url = new URL(window.location.href);
    url.searchParams.set("basket", id);
    window.history.replaceState(null, "", url);
    try { localStorage.setItem("basketly-basket", id); } catch { /* URL selection still works. */ }
    window.dispatchEvent(new Event(eventName));
  }
  return { basketId, select };
}
