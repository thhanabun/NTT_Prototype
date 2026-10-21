import { AdminAccess } from "@/components/auth/admin-access";
import { AuthUnavailable } from "@/components/auth/auth-unavailable";
import { mockAuthEnabled } from "@/lib/auth/config";

export default function AdminPage() {
  return (
    mockAuthEnabled ? <AdminAccess /> : <AuthUnavailable />
  );
}
