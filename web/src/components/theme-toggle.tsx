"use client";

import { Moon, Sun } from "lucide-react";

// The theme lives on <html data-theme>; CSS chooses the icon, so there is no hydration mismatch.
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "night" ? "day" : "night";
  setTheme(next);
}

export function setTheme(theme: "day" | "night") {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("fast-theme", theme); } catch { /* private mode: the theme still applies for this visit */ }
}

export function ThemeToggle() {
  const toggle = toggleTheme;
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="สลับโหมดแสง (ปกติ / Night)" title="สลับโหมดปกติ / Night">
      <Moon className="icon-moon" size={18} aria-hidden="true" />
      <Sun className="icon-sun" size={18} aria-hidden="true" />
    </button>
  );
}
