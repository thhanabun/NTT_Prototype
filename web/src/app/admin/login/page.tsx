import { AdminLogin } from "@/components/auth/admin-login";
import { AuthUnavailable } from "@/components/auth/auth-unavailable";
import { adminAuthEnabled } from "@/lib/auth/config";

export default function AdminLoginPage() {
  return adminAuthEnabled ? <AdminLogin /> : <AuthUnavailable />;
}
