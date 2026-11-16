import { notFound } from "next/navigation";
import { AdminAccess } from "@/components/auth/admin-access";
import { StoreMapFrame, type StoreMapView } from "@/components/admin/store-map-frame";

const VIEWS: StoreMapView[] = ["setup", "sync", "map"];
export function generateStaticParams() { return VIEWS.map(view => ({ view })); }

export default async function AdminCamerasPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!VIEWS.includes(view as StoreMapView)) notFound();
  return <AdminAccess><StoreMapFrame view={view as StoreMapView} /></AdminAccess>;
}
