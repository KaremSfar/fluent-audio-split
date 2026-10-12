import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeContext';
import { resolveTheme } from './theme';

const FALLBACK: ThemeContextValue = {
  preference: 'system',
  get theme() {
    return resolveTheme('system');
  },
  setPreference: () => {},
};

/** Current theme. Outside a `ThemeProvider` (isolated tests/stories) it reports the system theme. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK;
}
