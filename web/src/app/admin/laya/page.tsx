import { AdminAccess } from "@/components/auth/admin-access";
import { AdminWorkspace } from "@/components/admin/admin-workspace";

export default function AdminLayaPage() {
  return <AdminAccess><AdminWorkspace chatAtStart /></AdminAccess>;
}
