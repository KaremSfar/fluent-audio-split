import { STEM_COLORS } from '@/lib/models';
import type { NodeType } from '@/types/workflow';

// Hex values for the Tailwind shades used by STEM_COLORS (waveform fills can't take class names).
const HEX: Record<string, string> = {
  'rose-400': '#fb7185', 'amber-400': '#fbbf24', 'emerald-400': '#34d399', 'slate-400': '#94a3b8',
  'orange-400': '#fb923c', 'sky-400': '#38bdf8', 'indigo-400': '#818cf8', 'red-300': '#fca5a5',
  'teal-400': '#2dd4bf', 'cyan-400': '#22d3ee', 'blue-300': '#93c5fd', 'lime-400': '#a3e635',
  'yellow-300': '#fde047', 'orange-300': '#fdba74', 'green-300': '#86efac', 'red-400': '#f87171',
  'yellow-400': '#facc15', 'emerald-300': '#6ee7b7', 'teal-300': '#5eead4', 'blue-400': '#60a5fa',
  'pink-400': '#f472b6', 'purple-300': '#d8b4fe', 'sky-300': '#7dd3fc',
};

const FALLBACK = '#a78bfa';
const MERGE = '#2dd4bf';

/** CSS colour for a result track: the stem's colour, teal for merges, violet when unknown. */
export function stemColor(outputName: string, nodeType: NodeType): string {
  if (nodeType === 'Merge') return MERGE;
  const cls = STEM_COLORS[outputName];
  const key = cls?.replace(/^bg-/, '');
  return (key && HEX[key]) || FALLBACK;
}
