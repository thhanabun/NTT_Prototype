import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Anuphan, Chakra_Petch, JetBrains_Mono } from "next/font/google";
import { AppNavigation } from "@/components/app-navigation";
import "./globals.css";

const anuphan = Anuphan({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-anuphan", display: "swap" });
const chakra = Chakra_Petch({ subsets: ["thai", "latin"], weight: ["500", "600", "700"], variable: "--font-chakra", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "FAST | Smart Shopping",
  description: "FAST — ช้อปสะดวก จัดการร้านได้ในที่เดียว",
};

// Applies the saved theme before first paint so night mode does not flash day colors.
const themeScript = `try{var t=localStorage.getItem("fast-theme");if(t==="night"||t==="day")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={`${anuphan.variable} ${chakra.variable} ${jetbrains.variable} h-full antialiased`} data-theme="day" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AppNavigation />
        <main className="site-main">
          {children}
        </main>
      </body>
    </html>
  );
}
