import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './ThemeContext';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  systemPrefersDark,
  watchSystemTheme,
  type ThemePreference,
} from './theme';

/** Light / dark / system theme. Default `system`; persisted in localStorage; `dark` class on `<html>`. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const theme = resolveTheme(preference, systemDark);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => watchSystemTheme(setSystemDark), []);
  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      setPref(isThemePreference(e.newValue) ? e.newValue : 'system');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    storePreference(pref);
    setPref(pref);
  }, []);

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
