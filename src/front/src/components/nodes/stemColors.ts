import { STEM_COLORS } from '@/lib/models';
import { MERGE_OUTPUT } from '@/types/workflow';

export const MERGE_COLOR = '#0d9488'; // teal-600
export const KEEP_COLOR = '#f59e0b'; // amber-500

/** Hex color of an output handle / edge: stem color for Split outputs, teal for Merge's Mix. */
export function outputColorHex(output: string): string {
  if (output === MERGE_OUTPUT) return MERGE_COLOR;
  return stemColorHex(STEM_COLORS[output] ?? 'bg-slate-400');
}

export function stemColorHex(twClass: string): string {
  const map: Record<string, string> = {
    'bg-rose-400': '#fb7185',
    'bg-amber-400': '#fbbf24',
    'bg-emerald-400': '#34d399',
    'bg-slate-400': '#94a3b8',
    'bg-orange-400': '#fb923c',
    'bg-sky-400': '#38bdf8',
    'bg-indigo-400': '#818cf8',
    'bg-red-300': '#fca5a5',
    'bg-teal-400': '#2dd4bf',
    'bg-cyan-400': '#22d3ee',
    'bg-blue-300': '#93c5fd',
    'bg-lime-400': '#a3e635',
    'bg-yellow-300': '#fde047',
    'bg-orange-300': '#fdba74',
    'bg-green-300': '#86efac',
    'bg-red-400': '#f87171',
    'bg-yellow-400': '#facc15',
    'bg-emerald-300': '#6ee7b7',
    'bg-teal-300': '#5eead4',
    'bg-blue-400': '#60a5fa',
    'bg-pink-400': '#f472b6',
    'bg-purple-300': '#d8b4fe',
    'bg-sky-300': '#7dd3fc',
    'bg-slate-300': '#cbd5e1',
    'bg-violet-300': '#c4b5fd',
    'bg-green-400': '#4ade80',
    'bg-emerald-200': '#a7f3d0',
    'bg-amber-200': '#fde68a',
  };
  return map[twClass] ?? '#8b5cf6';
}

