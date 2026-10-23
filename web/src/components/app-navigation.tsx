"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingBasket, Zap } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
const routes = [
  { href: "/shopper", label: "Shopper", icon: ShoppingBasket },
  { href: "/admin", label: "Admin", icon: LayoutDashboard },
];
export function AppNavigation() {
  const pathname = usePathname();
  return <header className="site-header"><div className="site-header-inner">
    <Link className="fast-brand" href="/" aria-label="FAST หน้าหลัก"><span className="fast-symbol"><Zap size={21} fill="currentColor" aria-hidden="true" /></span><span>FAST<span className="brand-period">.</span></span></Link>
    <div className="header-tools">
      <nav aria-label="Main navigation" className="site-nav">{routes.map(({ href, label, icon: Icon }) => <Link href={href} key={href} aria-current={pathname.startsWith(href) ? "page" : undefined}><Icon size={16} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
      <ThemeToggle />
    </div>
  </div></header>;
}
