import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { executionsService } from '@/services/executionsService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WorkflowExecutionStatus } from '@/types/execution';

function statusColor(status: WorkflowExecutionStatus): string {
  switch (status) {
    case 'Completed': return 'bg-green-100 text-green-800';
    case 'Running': return 'bg-blue-100 text-blue-800';
    case 'Failed': return 'bg-red-100 text-red-800';
    case 'PartiallyFailed': return 'bg-yellow-100 text-yellow-800';
    case 'Cancelled': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function ExecutionsListPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, isLoading, navigate]);

  const { data: executions = [], isLoading: listLoading } = useQuery({
    queryKey: ['executions'],
    queryFn: executionsService.list,
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80">
            <span className="text-xl">🎵</span>
            <span className="font-semibold text-foreground">Fluent Audio Split</span>
          </button>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
            ← Dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Execution History</h1>
          <Button onClick={() => navigate('/workflows/new')}>⚡ New Execution</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Executions</CardTitle>
          </CardHeader>
          <CardContent>
            {listLoading ? (
              <p className="text-muted-foreground py-4 text-center">Loading…</p>
            ) : executions.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center">No executions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.map((ex) => (
                    <TableRow key={ex.id}>
                      <TableCell className="font-medium">{ex.workflowName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {ex.inputFile?.originalFileName ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(ex.status)}`}
                        >
                          {ex.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(ex.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Link to={`/executions/${ex.id}`}>
                          <Button size="sm" variant="outline">View →</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
