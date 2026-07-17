import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppHeader } from '@/components/layout/AppHeader';
import { ExecuteTrimDialog } from '@/components/execution/ExecuteTrimDialog';
import { Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workflowsService } from '@/services/workflowsService';
import { executionsService } from '@/services/executionsService';
import type { Workflow } from '@/types/workflow';

const NAV_CARDS = [
  { emoji: '📋', title: 'Execution History', description: 'View past and running executions', path: '/executions' },
];

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workflowToRun, setWorkflowToRun] = useState<Workflow | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, navigate]);

  const { data: workflows, isLoading: workflowsLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: workflowsService.list,
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: workflowsService.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: () => {
      window.alert('Unable to delete this workflow. Please try again.');
    },
  });

  const executeMutation = useMutation({
    mutationFn: (args: { fileId: string; trimStart?: number; trimEnd?: number }) => {
      if (!workflowToRun) throw new Error('Choose a workflow before starting an execution.');
      return executionsService.start(workflowToRun.id, args.fileId, args.trimStart, args.trimEnd);
    },
    onSuccess: (execution) => {
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
      setWorkflowToRun(null);
      navigate(`/executions/${execution.id}`);
    },
  });

  const handleDelete = (event: React.MouseEvent<HTMLButtonElement>, workflow: Workflow) => {
    event.stopPropagation();
    if (window.confirm(`Delete workflow "${workflow.name}"? It will be removed from your workflow list, but its execution history will remain available.`)) {
      deleteMutation.mutate(workflow.id);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader>
        <span className="text-sm text-muted-foreground">{user?.email}</span>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign out
        </Button>
      </AppHeader>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome to Fluent Audio Split
            </h1>
            <p className="text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user?.email}</span>
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {NAV_CARDS.map((card) => (
              <Card
                key={card.path}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(card.path)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">{card.emoji}</span>
                    {card.title}
                  </CardTitle>
                  <CardDescription>{card.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">Open →</Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">My Workflows</h2>
              <Button size="sm" onClick={() => navigate('/workflows/new')}>+ New Workflow</Button>
            </div>
            {workflowsLoading ? (
              <p className="text-muted-foreground text-sm">Loading workflows…</p>
            ) : !workflows?.length ? (
              <p className="text-muted-foreground text-sm">No workflows yet. Create one to get started.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {workflows.map((wf) => (
                  <Card
                    key={wf.id}
                    className="cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/workflows/${wf.id}`)}
                    onKeyDown={(event) => {
                      if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        navigate(`/workflows/${wf.id}`);
                      }
                    }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base flex items-center gap-2">
                        <span>🔧</span>
                        {wf.name}
                        </CardTitle>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete workflow ${wf.name}`}
                          title={`Delete workflow ${wf.name}`}
                          disabled={deleteMutation.isPending}
                          onClick={(event) => handleDelete(event, wf)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <CardDescription className="text-xs">
                        {wf.nodes.length} node{wf.nodes.length !== 1 ? 's' : ''} · Updated {new Date(wf.updatedAt).toLocaleDateString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1"
                        onClick={(event) => {
                          event.stopPropagation();
                          setWorkflowToRun(wf);
                        }}
                      >
                        <Play />
                        Run
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/workflows/${wf.id}`);
                        }}
                      >
                        Open →
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      {workflowToRun && (
        <ExecuteTrimDialog
          isPending={executeMutation.isPending}
          onExecute={(args) => executeMutation.mutate(args)}
          onClose={() => setWorkflowToRun(null)}
        />
      )}
    </div>
  );
}
