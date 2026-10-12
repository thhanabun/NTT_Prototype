import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <section className="flex flex-1 flex-col justify-center gap-10 py-10">
      <div className="max-w-2xl space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Phase 4 · Shopper API integration
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Basketly web app
        </h1>
        <p className="max-w-xl text-lg leading-8 text-muted-foreground">
          The Shopper app now uses local basket sessions, carts, confirmations, and mock
          checkout. The Admin foundation is ready for its next phase.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Shopper</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Pair a basket, review its confirmed cart, answer uncertain-item cases, and
              complete a mock checkout using the local backend.
            </p>
          </div>
          <Button className="w-fit" nativeButton={false} render={<Link href="/shopper" />}>
            Open Shopper route
          </Button>
        </article>

        <article className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Admin</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Reserved route for store overview, case review, and staff decisions.
            </p>
          </div>
          <Button className="w-fit" variant="outline" nativeButton={false} render={<Link href="/admin" />}>
            Open Admin route
          </Button>
        </article>
      </div>

      <p className="text-sm text-muted-foreground">
        Development API proxy: <code className="font-mono">/api/*</code> → local Node API on port 3000.
      </p>
    </section>
  );
}
