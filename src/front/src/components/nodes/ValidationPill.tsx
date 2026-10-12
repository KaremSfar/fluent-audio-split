import type { Issue } from '@/lib/workflowGraph';

interface ValidationPillProps {
  issues: Issue[];
  /** Select the first offending node (opens its side panel). */
  onSelectNode: (nodeId: string) => void;
}

export function ValidationPill({ issues, onSelectNode }: ValidationPillProps) {
  if (issues.length === 0) return null;
  const text = issues.map((i) => i.message).join('\n');
  return (
    <button
      type="button"
      onClick={() => onSelectNode(issues[0].nodeId)}
      title={text}
      aria-label={`${issues.length} workflow ${issues.length === 1 ? 'issue' : 'issues'}: ${text}`}
      className="shrink-0 text-xs font-medium rounded-full border border-amber-300 bg-amber-50 text-amber-800 px-2.5 py-1 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
    >
      ⚠ {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
    </button>
  );
}
