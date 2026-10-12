import { describe, expect, it } from 'vitest';
import { isThemePreference, resolveTheme } from './theme';
import { mixHex, stemColor } from '@/components/daw/stemColor';

describe('theme', () => {
  it('resolves system against the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('validates stored values', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('blue')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('stem colours per theme', () => {
  it('uses a deep shade on the light studio and the bright shade on dark', () => {
    expect(stemColor('Vocals', 'AudioSeparation', 'light')).toBe('#e11d48');
    expect(stemColor('Vocals', 'AudioSeparation', 'dark')).toBe('#fb7185');
    expect(stemColor('Mix', 'Merge', 'light')).toBe('#0f766e');
    expect(stemColor('nope', 'AudioSeparation', 'dark')).toBe('#a78bfa');
  });

  it('mixes opaquely over the lane colour', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#ffffff', 1)).toBe('#ff0000');
    expect(mixHex('red', '#ffffff', 0.5)).toBe('red');
  });
});
