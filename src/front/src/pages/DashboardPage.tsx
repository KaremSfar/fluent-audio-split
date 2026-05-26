import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppHeader } from '@/components/layout/AppHeader';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workflowsService } from '@/services/workflowsService';

const NAV_CARDS = [
  { emoji: '🎵', title: 'My Files', description: 'Upload and manage audio files', path: '/files' },
  { emoji: '⚡', title: 'Run Workflow', description: 'Create and start a new execution', path: '/workflows/new' },
  { emoji: '📋', title: 'Execution History', description: 'View past and running executions', path: '/executions' },
];

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();

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
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(`/workflows/${wf.id}`)}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span>🔧</span>
                        {wf.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {wf.nodes.length} node{wf.nodes.length !== 1 ? 's' : ''} · Updated {new Date(wf.updatedAt).toLocaleDateString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm" className="w-full">Open →</Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
