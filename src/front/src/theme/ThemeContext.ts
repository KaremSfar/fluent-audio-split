import { createContext } from 'react';
import type { ResolvedTheme, ThemePreference } from './theme';

export interface ThemeContextValue {
  /** What the user picked (persisted; `system` follows the OS). */
  preference: ThemePreference;
  /** What is actually applied right now. */
  theme: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
