import { AdminAccess } from "@/components/auth/admin-access";
import { StoreMapFrame } from "@/components/admin/store-map-frame";

export default function AdminLivePage() {
  return <AdminAccess><StoreMapFrame view="live" /></AdminAccess>;
}
