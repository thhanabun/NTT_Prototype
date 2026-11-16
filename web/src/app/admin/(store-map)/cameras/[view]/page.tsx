import { notFound } from "next/navigation";

const VIEWS = ["setup", "sync", "map"];
export function generateStaticParams() { return VIEWS.map(view => ({ view })); }

// Drawn by the (store-map) layout's shared frame.
export default async function AdminCamerasPage({ params }: { params: Promise<{ view: string }> }) {
  if (!VIEWS.includes((await params).view)) notFound();
  return null;
}
