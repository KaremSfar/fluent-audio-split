import type { WorkflowExecutionStatus, NodeExecutionStatus } from '@/types/execution';

interface StatusBadgeProps {
  status: WorkflowExecutionStatus | NodeExecutionStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getColorClass = (status: WorkflowExecutionStatus | NodeExecutionStatus): string => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-200';
      case 'Running':
        return 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-200';
      case 'Failed':
        return 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-200';
      case 'PartiallyFailed':
        return 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-200';
      case 'Cancelled':
        return 'bg-muted text-muted-foreground';
      case 'Pending':
      case 'Queued':
        return 'bg-muted text-foreground';
      default:
        return 'bg-muted text-foreground';
    }
  };

  const colorClass = getColorClass(status);

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}>
      {status}
    </span>
  );
}
