"use client";

import { Moon, Sun } from "lucide-react";

const storageKey = "mnp-theme-v1";

export function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const nextTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", nextTheme);
    try {
      localStorage.setItem(storageKey, nextTheme);
    } catch {
      // The selected theme still applies for the current page when storage is unavailable.
    }
  }

  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label="สลับ Light และ Dark mode"
    >
      <Sun className="theme-icon-light" size={16} aria-hidden="true" />
      <Moon className="theme-icon-dark" size={16} aria-hidden="true" />
    </button>
  );
}
