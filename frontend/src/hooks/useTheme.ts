import { useState, useEffect, useCallback } from "react";
import { getJson, setJson } from "../utils/storage";

const THEME_KEY = "qf_theme";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const stored = getJson<Theme | null>(THEME_KEY, null);
  if (stored === "light" || stored === "dark") return stored;
  // Respect system preference
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    setJson(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
