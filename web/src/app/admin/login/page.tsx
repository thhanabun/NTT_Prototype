import { AdminLogin } from "@/components/auth/admin-login";
import { AuthUnavailable } from "@/components/auth/auth-unavailable";
import { mockAuthEnabled } from "@/lib/auth/config";

export default function AdminLoginPage() {
  return mockAuthEnabled ? <AdminLogin /> : <AuthUnavailable />;
}
