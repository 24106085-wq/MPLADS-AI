// src/utils/theme.js
//
// Manual dark-mode toggle (tail end of item 1). The CSS already supports
// three states on <html data-theme="...">:
//   - "dark"  -> forces dark mode regardless of OS setting
//   - "light" -> forces light mode regardless of OS setting
//   - absent  -> follows the OS-level `prefers-color-scheme`
// (see index.css's THEME TOKENS block). This file is the single place that
// reads/writes the saved preference so Settings.jsx and main.jsx stay in
// sync without duplicating the localStorage key or the three valid values.

export const THEME_STORAGE_KEY = "mplads_theme_preference";

export const THEME_OPTIONS = ["system", "light", "dark"];

// Returns "system" | "light" | "dark". Falls back to "system" for anything
// missing/unrecognized (first visit, corrupted value, etc.) rather than
// throwing — theme preference should never break page load.
export function getStoredThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_OPTIONS.includes(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

// Applies a preference to <html>. "system" removes data-theme entirely so
// the prefers-color-scheme media query in index.css takes back over.
export function applyThemePreference(preference) {
  const root = document.documentElement;
  if (preference === "dark" || preference === "light") {
    root.dataset.theme = preference;
  } else {
    delete root.dataset.theme;
  }
}

// Persists the preference and applies it in one step — what the Settings
// toggle calls.
export function setThemePreference(preference) {
  const value = THEME_OPTIONS.includes(preference) ? preference : "system";
  try {
    if (value === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    }
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — still apply it
    // for this session even though it won't persist across reloads.
  }
  applyThemePreference(value);
}
