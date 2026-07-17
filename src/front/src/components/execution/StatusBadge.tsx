import type { WorkflowExecutionStatus, NodeExecutionStatus } from '@/types/execution';

interface StatusBadgeProps {
  status: WorkflowExecutionStatus | NodeExecutionStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getColorClass = (status: WorkflowExecutionStatus | NodeExecutionStatus): string => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-800';
      case 'Running':
        return 'bg-blue-100 text-blue-800';
      case 'Failed':
        return 'bg-red-100 text-red-800';
      case 'PartiallyFailed':
        return 'bg-yellow-100 text-yellow-800';
      case 'Cancelled':
        return 'bg-gray-100 text-gray-600';
      case 'Pending':
      case 'Queued':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const colorClass = getColorClass(status);

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}>
      {status}
    </span>
  );
}
