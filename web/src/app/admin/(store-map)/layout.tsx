import type { ReactNode } from "react";
import { AdminAccess } from "@/components/auth/admin-access";
import { StoreMapFrame } from "@/components/admin/store-map-frame";

// One store-map frame for ร้านสด and the three camera views: switching view only changes its #hash,
// so there is never more than one copy of the map page (several copies overwrote each other's saved map).
export default function StoreMapLayout({ children }: { children: ReactNode }) {
  return <AdminAccess><StoreMapFrame />{children}</AdminAccess>;
}
