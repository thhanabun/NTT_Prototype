import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppNavigation } from "@/components/app-navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAST | Smart Shopping",
  description: "FAST — ช้อปสะดวก จัดการร้านได้ในที่เดียว",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AppNavigation />
        <main className="site-main">
          {children}
        </main>
      </body>
    </html>
  );
}
