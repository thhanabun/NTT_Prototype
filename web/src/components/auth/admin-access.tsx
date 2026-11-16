"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminWorkspace } from "@/components/admin/admin-workspace";
import { adminAuthEnabled, cloudAuthEnabled } from "@/lib/auth/config";
import { expireMockSession } from "@/lib/auth/mock-session";
import { signOutAdmin, useAdminSession } from "@/lib/auth/session";
import { AuthUnavailable } from "./auth-unavailable";
import styles from "./auth.module.css";

export function AdminAccess({ children }: { children?: ReactNode }) {
  const auth = useAdminSession();
  const router = useRouter();
  useEffect(() => {
    if (adminAuthEnabled && (auth.status === "signed-out" || auth.status === "expired")) router.replace("/admin/login");
  }, [auth.status, router]);

  if (!adminAuthEnabled) return <AuthUnavailable />;
  if (auth.status !== "signed-in") return <p className={styles.status} role="status">กำลังตรวจสอบสิทธิ์…</p>;

  const identity = `${cloudAuthEnabled ? "พนักงาน" : "บัญชีทดสอบ"} · ${auth.session.email}`;
  const tools = !cloudAuthEnabled && <details className={styles.tools}><summary>เครื่องมือทดสอบ</summary><button className={styles.secondary} onClick={expireMockSession}>จำลอง session หมดอายุ</button></details>;
  return <AdminShell identity={identity} tools={tools} onSignOut={() => void signOutAdmin()}>{children ?? <AdminWorkspace />}</AdminShell>;
}
