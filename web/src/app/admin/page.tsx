import { AdminAccess } from "@/components/auth/admin-access";
import { AuthUnavailable } from "@/components/auth/auth-unavailable";
import { adminAuthEnabled } from "@/lib/auth/config";

export default function AdminPage() {
  return (
    adminAuthEnabled ? <AdminAccess /> : <AuthUnavailable />
  );
}
