"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { applyTheme, THEME_STORAGE_KEY, THEMES, type Theme } from "@/lib/theme/theme";

const ICONS = { light: Sun, dark: Moon, system: Monitor };

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  // Follow OS changes while in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
  const labels = { light: t.shell.themeLight, dark: t.shell.themeDark, system: t.shell.themeSystem };
  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        applyTheme(next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          /* storage unavailable: theme still applies for this page view */
        }
      }}
      className="grid h-8 w-8 place-items-center rounded-lg text-fg-muted hover:bg-muted hover:text-fg"
      title={`${t.shell.theme}: ${labels[theme]}`}
      aria-label={`${t.shell.theme}: ${labels[theme]} → ${labels[next]}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
