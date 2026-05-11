import { useEffect, useState } from "react";

type Theme = "dark" | "light";
export const THEME_KEY = "astronomer-lite-theme";

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

export function getStoredTheme(): Theme {
  const value = localStorage.getItem(THEME_KEY);
  return isTheme(value) ? value : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(THEME_KEY, theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return {
    theme,
    toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark"))
  };
}
