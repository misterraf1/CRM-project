export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_STORAGE_KEY = "axis-theme";

// Runs before first paint (inlined in <head>) to avoid a light→dark flash.
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||((!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
