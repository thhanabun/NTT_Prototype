"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { adminAuthEnabled, cloudAuthEnabled } from "@/lib/auth/config";
import { expireMockSession } from "@/lib/auth/mock-session";
import { signOutAdmin, useAdminSession } from "@/lib/auth/session";
import { AuthUnavailable } from "./auth-unavailable";
import styles from "./auth.module.css";

export function AdminAccess() {
  const auth = useAdminSession();
  const router = useRouter();
  useEffect(() => {
    if (adminAuthEnabled && (auth.status === "signed-out" || auth.status === "expired")) router.replace("/admin/login");
  }, [auth.status, router]);

  if (!adminAuthEnabled) return <AuthUnavailable />;
  if (auth.status !== "signed-in") return <p className={styles.status} role="status">กำลังตรวจสอบสิทธิ์…</p>;

  return <>
    <div className={styles.toolbar} aria-label="Admin session">
      <div className={styles.identity}><span className={styles.badge}>{cloudAuthEnabled ? "พนักงาน" : "บัญชีทดสอบ"}</span><span>{auth.session.email}</span></div>
      <div className={styles.tools}>
        {!cloudAuthEnabled && <details><summary>เครื่องมือทดสอบ</summary><button className={styles.secondary} onClick={expireMockSession}>จำลอง session หมดอายุ</button></details>}
        <button className={styles.secondary} onClick={() => void signOutAdmin()}><LogOut size={15} aria-hidden="true" /> ออกจากระบบ</button>
      </div>
    </div>
    <AdminDashboard />
  </>;
}
