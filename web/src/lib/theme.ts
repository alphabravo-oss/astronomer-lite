import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";
export const THEME_KEY = "astronomer-lite-theme";
const THEME_EVENT = "astronomer-lite-theme-change";

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
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY) {
      document.documentElement.classList.toggle("dark", getStoredTheme() === "dark");
      onChange();
    }
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(THEME_EVENT, onChange); window.removeEventListener("storage", onStorage); };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getStoredTheme);
  return {
    theme,
    toggleTheme: () => applyTheme(theme === "dark" ? "light" : "dark")
  };
}
