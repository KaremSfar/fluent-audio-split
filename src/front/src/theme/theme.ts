/**
 * Theme preference handling shared by the provider and the pre-paint script in `index.html`
 * (which duplicates `THEME_STORAGE_KEY` and the resolve/apply logic so there is no flash on load).
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'fas:theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function storePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then lasts for this tab only.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches;
}

export function resolveTheme(pref: ThemePreference, systemDark = systemPrefersDark()): ResolvedTheme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/** Puts the `dark` class and `color-scheme` on `<html>` (native controls and scrollbars follow). */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  const mq = window.matchMedia?.(DARK_QUERY);
  if (!mq) return () => {};
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
