import Link from "next/link";
import { Button } from "@/components/ui/button";

interface RoutePlaceholderProps {
  title: string;
  description: string;
}

export function RoutePlaceholder({ title, description }: RoutePlaceholderProps) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        App route ready
      </p>
      <div className="max-w-2xl space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="text-lg leading-8 text-muted-foreground">{description}</p>
      </div>
      <Button className="w-fit" variant="outline" nativeButton={false} render={<Link href="/" />}>
        Back to project overview
      </Button>
    </section>
  );
}
