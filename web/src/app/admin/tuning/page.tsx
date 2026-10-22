import { AdminAccess } from "@/components/auth/admin-access";
import { AuthUnavailable } from "@/components/auth/auth-unavailable";
import { TuningPage } from "@/components/tuning/tuning-page";
import { mockAuthEnabled } from "@/lib/auth/config";

export default function AdminTuningPage() {
  return mockAuthEnabled ? <AdminAccess><TuningPage /></AdminAccess> : <AuthUnavailable />;
}
