"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { mockAccount, adminAuthEnabled, cloudAuthEnabled } from "@/lib/auth/config";
import { signInMock } from "@/lib/auth/mock-session";
import { useAdminSession } from "@/lib/auth/session";
import { AuthUnavailable } from "./auth-unavailable";
import styles from "./auth.module.css";

export function AdminLogin() {
  const auth = useAdminSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<{ email?: string; password?: string }>({});
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  // Cached routes can suspend effects and restore this form with pending state.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      try { signInMock(email, password); setPassword(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่"); }
      finally { locked.current = false; setPending(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [pending, email, password]);
  useEffect(() => {
    if (adminAuthEnabled && auth.status === "signed-in") router.replace("/admin");
  }, [auth.status, router]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const next = {
      email: !email.trim() ? "กรุณากรอกอีเมล" : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "กรุณากรอกอีเมลให้ถูกต้อง" : undefined,
      password: !password ? "กรุณากรอกรหัสผ่าน" : undefined,
    };
    setFields(next);
    setError("");
    if (next.email || next.password) {
      (next.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    locked.current = true;
    setPending(true);
  }

  if (!adminAuthEnabled) return <AuthUnavailable />;
  if (cloudAuthEnabled && auth.status !== "signed-in") return <section className={styles.panel}><h1>เข้าสู่ระบบ Admin</h1><p>ใช้บัญชีพนักงานของร้านเพื่อเข้าถึง Dashboard</p><button className={styles.primary} onClick={() => window.location.assign(new URL("/api/auth/login", window.location.origin).href)}>เข้าสู่ระบบพนักงาน</button></section>;
  if (auth.status === "checking" || auth.status === "signed-in") return <p className={styles.status} role="status">กำลังตรวจสอบสิทธิ์…</p>;

  return <section className={styles.shell} aria-label="Admin login">
    <div className={styles.intro}>
      <div className={styles.icon}><ShieldCheck size={26} aria-hidden="true" /></div>
      <p className={styles.eyebrow}>FAST / STAFF ACCESS</p>
      <h1>ทุกรายการ<br />อยู่ในการดูแล.</h1>

      <Link href="/shopper">ไป Shopper App →</Link>
    </div>
    <div className={styles.panel}>
      <span className={styles.badge}>สำหรับพนักงาน</span>
      <h2>เข้าสู่ระบบ Admin</h2>

      {auth.status === "expired" && <p className={styles.notice} role="status">Mock session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง</p>}
      <form className={styles.form} onSubmit={submit} noValidate aria-busy={pending}>
        <div className={styles.field}>
          <label htmlFor="admin-email">Email</label>
          <input id="admin-email" ref={emailInput} name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} disabled={pending} onChange={event => setEmail(event.target.value)} aria-invalid={!!fields.email} aria-describedby={fields.email ? "email-error" : undefined} placeholder="name@example.com" />
          {fields.email && <p className={styles.fieldError} id="email-error">{fields.email}</p>}
        </div>
        <div className={styles.field}>
          <label htmlFor="admin-password">Password</label>
          <div className={styles.password}>
            <input id="admin-password" ref={passwordInput} name="password" type={visible ? "text" : "password"} autoComplete="current-password" required value={password} disabled={pending} onChange={event => setPassword(event.target.value)} aria-invalid={!!fields.password} aria-describedby={fields.password ? "password-error" : undefined} placeholder="กรอกรหัสผ่าน" />
            <button type="button" className={styles.toggle} disabled={pending} aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
          </div>
          {fields.password && <p className={styles.fieldError} id="password-error">{fields.password}</p>}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primary} type="submit" disabled={pending}>{pending ? <><LoaderCircle className={styles.spin} size={17} aria-hidden="true" /><span role="status">กำลังเข้าสู่ระบบ…</span></> : <>เข้าสู่ระบบ<ArrowRight size={17} aria-hidden="true" /></>}</button>
      </form>
      <div className={styles.demo}><strong>บัญชีสำหรับทดลอง</strong><p>Email: <code>{mockAccount.email}</code></p><p>Password: <code>{mockAccount.password}</code></p><p className={styles.muted}>บัญชีทดสอบ · ไม่ต้องใช้รหัสผ่านส่วนตัว</p></div>
    </div>
  </section>;
}
