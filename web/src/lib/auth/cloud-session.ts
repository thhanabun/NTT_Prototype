"use client";
import { useSyncExternalStore } from "react";

type State = { status: "checking" | "signed-out" | "expired"; session: null } | { status: "signed-in"; session: { email: string; expiresAt: number } };
const initial: State = { status: "checking", session: null };
let state: State = initial;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
function publish(next: State) { state = next; listeners.forEach(listener => listener()); }
async function synchronize() {
  clearTimeout(timer);
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout(12000) });
    const body = await response.json();
    if (!response.ok || typeof body.email !== "string" || !Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now()) { publish({ status: "signed-out", session: null }); return; }
    publish({ status: "signed-in", session: body });
    if (listeners.size) timer = setTimeout(() => publish({ status: "expired", session: null }), body.expiresAt - Date.now());
  } catch { publish({ status: "signed-out", session: null }); }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) { window.addEventListener("focus", synchronize); void synchronize(); }
  return () => { listeners.delete(listener); if (!listeners.size) { clearTimeout(timer); window.removeEventListener("focus", synchronize); } };
}
export function useCloudSession() { return useSyncExternalStore(subscribe, () => state, () => initial); }
export async function signOutCloud() {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (response.ok) { const body = await response.json(); publish({ status: "signed-out", session: null }); if (typeof body.logoutUrl === "string" && body.logoutUrl.startsWith("https://")) window.location.assign(body.logoutUrl); }
}
