import { STEM_COLORS } from '@/lib/models';
import type { NodeType } from '@/types/workflow';
import type { ResolvedTheme } from '@/theme/theme';

/**
 * Hex values per Tailwind hue: `light` is a deep shade (≥ 3:1 on white, so waveforms and swatches
 * read on the light studio), `dark` is the bright shade used by STEM_COLORS (≥ 3:1 on the dark lanes).
 */
const HUES: Record<string, { light: string; dark: Record<string, string> }> = {
  rose: { light: '#e11d48', dark: { '400': '#fb7185' } },
  amber: { light: '#d97706', dark: { '200': '#fde68a', '400': '#fbbf24' } },
  emerald: { light: '#059669', dark: { '200': '#a7f3d0', '300': '#6ee7b7', '400': '#34d399' } },
  slate: { light: '#64748b', dark: { '300': '#cbd5e1', '400': '#94a3b8' } },
  orange: { light: '#ea580c', dark: { '300': '#fdba74', '400': '#fb923c' } },
  sky: { light: '#0284c7', dark: { '300': '#7dd3fc', '400': '#38bdf8' } },
  indigo: { light: '#4f46e5', dark: { '400': '#818cf8' } },
  red: { light: '#dc2626', dark: { '300': '#fca5a5', '400': '#f87171' } },
  teal: { light: '#0d9488', dark: { '300': '#5eead4', '400': '#2dd4bf' } },
  cyan: { light: '#0891b2', dark: { '400': '#22d3ee' } },
  blue: { light: '#2563eb', dark: { '300': '#93c5fd', '400': '#60a5fa' } },
  lime: { light: '#4d7c0f', dark: { '400': '#a3e635' } },
  yellow: { light: '#a16207', dark: { '300': '#fde047', '400': '#facc15' } },
  green: { light: '#16a34a', dark: { '300': '#86efac', '400': '#4ade80' } },
  pink: { light: '#db2777', dark: { '400': '#f472b6' } },
  purple: { light: '#9333ea', dark: { '300': '#d8b4fe' } },
  violet: { light: '#7c3aed', dark: { '300': '#c4b5fd', '400': '#a78bfa' } },
};

const FALLBACK = { light: '#7c3aed', dark: '#a78bfa' };
const MERGE = { light: '#0f766e', dark: '#2dd4bf' };

/** CSS colour for a result track: the stem's colour, teal for merges, violet when unknown. */
export function stemColor(outputName: string, nodeType: NodeType, theme: ResolvedTheme = 'dark'): string {
  if (nodeType === 'Merge') return MERGE[theme];
  const m = /^bg-([a-z]+)-(\d+)$/.exec(STEM_COLORS[outputName] ?? '');
  const hue = m ? HUES[m[1]] : undefined;
  if (!hue) return FALLBACK[theme];
  return theme === 'light' ? hue.light : (hue.dark[m![2]] ?? Object.values(hue.dark)[0]);
}

/**
 * Opaque mix of `hex` over `base` (both `#rrggbb`), `amount` of `hex` (0..1). Wavesurfer paints
 * the played part by compositing over the unplayed canvas, which keeps the unplayed alpha, so the
 * dimmed colour must be opaque rather than translucent.
 */
export function mixHex(hex: string, base: string, amount: number): string {
  const re = /^#[0-9a-f]{6}$/i;
  if (!re.test(hex) || !re.test(base)) return hex;
  const t = Math.max(0, Math.min(1, amount));
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(ch(hex, i) * t + ch(base, i) * (1 - t)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Lane backgrounds (`--daw-lane`) as hex, for canvas drawing. Keep in sync with index.css. */
export const LANE_HEX = { light: '#ffffff', dark: '#0e0e11' } as const;
