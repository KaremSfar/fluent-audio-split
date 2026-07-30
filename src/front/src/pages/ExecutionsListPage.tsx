import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { executionsService } from '@/services/executionsService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/execution/StatusBadge';
import { AppHeader } from '@/components/layout/AppHeader';

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
      <AppHeader onLogoClick={() => navigate('/dashboard')}>
        <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
          ← Dashboard
        </Button>
      </AppHeader>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Execution History</h1>

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
              <Table className="table-fixed min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[24%]">Workflow</TableHead>
                    <TableHead className="w-[30%]">File</TableHead>
                    <TableHead className="w-[120px] whitespace-nowrap">Status</TableHead>
                    <TableHead className="w-[150px] whitespace-nowrap">Created</TableHead>
                    <TableHead className="w-[80px] whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.map((ex) => (
                    <TableRow key={ex.id}>
                      <TableCell className="font-medium">
                        <div className="truncate" title={ex.workflowName}>{ex.workflowName}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="truncate" title={ex.inputFile?.originalFileName}>
                          {ex.inputFile?.originalFileName ?? '—'}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={ex.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(ex.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
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
