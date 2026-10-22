"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { mockAuthEnabled } from "@/lib/auth/config";
import { expireMockSession, signOutMock, useMockSession } from "@/lib/auth/mock-session";
import { AuthUnavailable } from "./auth-unavailable";
import styles from "./auth.module.css";

// Guards an admin page behind the mock session; renders the dashboard unless given other content.
export function AdminAccess({ children }: { children?: ReactNode }) {
  const auth = useMockSession();
  const router = useRouter();
  useEffect(() => {
    if (mockAuthEnabled && (auth.status === "signed-out" || auth.status === "expired")) router.replace("/admin/login");
  }, [auth.status, router]);

  if (!mockAuthEnabled) return <AuthUnavailable />;
  if (auth.status !== "signed-in") return <p className={styles.status} role="status">กำลังตรวจสอบ mock session…</p>;

  return <>
    <div className={styles.toolbar} aria-label="Admin mock session">
      <div className={styles.identity}><span className={styles.badge}>MOCK SESSION</span><span>{auth.session.email}</span></div>
      <div className={styles.tools}>
        <details><summary>Mock session controls</summary><button className={styles.secondary} onClick={expireMockSession}>จำลอง session หมดอายุ</button></details>
        <button className={styles.secondary} onClick={signOutMock}><LogOut size={15} aria-hidden="true" /> Logout</button>
      </div>
    </div>
    {children ?? <AdminDashboard />}
  </>;
}
