import Link from "next/link";

const routes = [
  { href: "/shopper", label: "Shopper" },
  { href: "/admin", label: "Admin" },
  { href: "/admin/tuning", label: "Tuning" },
];

export function AppNavigation() {
  return (
    <header className="border-b bg-card/80">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 sm:px-8">
        <Link
          className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          href="/"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            B
          </span>
          <span>
            <span className="block font-semibold tracking-tight">Basketly</span>
            <span className="hidden text-xs text-muted-foreground sm:block">Smart basket prototype</span>
          </span>
        </Link>

        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-1">
          {routes.map((route) => (
            <Link
              className="rounded-md px-2 py-2 text-sm font-medium sm:px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href={route.href}
              key={route.href}
            >
              {route.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
