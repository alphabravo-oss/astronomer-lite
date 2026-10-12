import { useEffect, useState } from "react";

const KEY = "astronomer-lite-density";
export function useDensity() {
  const [compact, setCompact] = useState(() => localStorage.getItem(KEY) === "compact");
  useEffect(() => {
    const value = compact ? "compact" : "comfortable";
    document.documentElement.dataset.density = value;
    localStorage.setItem(KEY, value);
  }, [compact]);
  return { compact, toggleDensity: () => setCompact((value) => !value) };
}
