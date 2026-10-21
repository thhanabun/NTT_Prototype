"use client";

import { useSyncExternalStore } from "react";
import { mockAccount, mockAuthEnabled, mockSessionDuration, mockSessionKey } from "./config";

interface MockSession { email: string; expiresAt: number; }
type AuthSnapshot =
  | { status: "checking" | "signed-out" | "expired"; session: null }
  | { status: "signed-in"; session: MockSession };

const initial: AuthSnapshot = { status: "checking", session: null };
let snapshot: AuthSnapshot = initial;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish(next: AuthSnapshot) {
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}

function removeSession() {
  try { sessionStorage.removeItem(mockSessionKey); } catch { /* Storage may be blocked. */ }
}

function synchronize() {
  clearTimeout(timer);
  if (!mockAuthEnabled) {
    publish({ status: "signed-out", session: null });
    return;
  }
  try {
    const raw = sessionStorage.getItem(mockSessionKey);
    if (!raw) {
      publish({ status: snapshot.status === "expired" ? "expired" : "signed-out", session: null });
      return;
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("email" in value) || value.email !== mockAccount.email ||
        !("expiresAt" in value) || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) ||
        value.expiresAt > Date.now() + mockSessionDuration) {
      throw new Error("Invalid mock session");
    }
    if (value.expiresAt <= Date.now()) {
      removeSession();
      publish({ status: "expired", session: null });
      return;
    }
    publish({ status: "signed-in", session: { email: value.email, expiresAt: value.expiresAt } });
    if (listeners.size) timer = setTimeout(synchronize, value.expiresAt - Date.now());
  } catch {
    removeSession();
    publish({ status: "signed-out", session: null });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("focus", synchronize);
    window.addEventListener("pageshow", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    synchronize();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      window.removeEventListener("focus", synchronize);
      window.removeEventListener("pageshow", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    }
  };
}

// This is deliberately a local simulation. It never sends credentials to an API.
export function signInMock(email: string, password: string) {
  if (!mockAuthEnabled) throw new Error("Mock login is unavailable.");
  if (email.trim().toLowerCase() !== mockAccount.email || password !== mockAccount.password) {
    throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง ลองใช้บัญชีทดสอบด้านล่าง");
  }
  const session: MockSession = { email: mockAccount.email, expiresAt: Date.now() + mockSessionDuration };
  try { sessionStorage.setItem(mockSessionKey, JSON.stringify(session)); }
  catch { throw new Error("ไม่สามารถบันทึก session ในแท็บนี้ได้ โปรดอนุญาต browser storage แล้วลองใหม่"); }
  synchronize();
}

export function signOutMock() {
  clearTimeout(timer);
  removeSession();
  publish({ status: "signed-out", session: null });
}

export function expireMockSession() {
  clearTimeout(timer);
  removeSession();
  publish({ status: "expired", session: null });
}

export function useMockSession() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initial);
}
