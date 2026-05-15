import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import apiClient from '@/services/apiClient';

export default function DummyPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [isPending, setIsPending] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, navigate]);

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

  const handleSendHello = async () => {
    setIsPending(true);
    setTaskId(null);
    setError(null);
    try {
      const res = await apiClient.post<{ message: string; taskId: string }>('/dummy/hello');
      setTaskId(res.data.taskId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎵</span>
            <span className="font-semibold text-foreground">Fluent Audio Split</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-6">
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Hello World Test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Click the button to publish an <code>audio.hello_world</code> task to RabbitMQ via the C# API.
            </p>
            <Button onClick={handleSendHello} disabled={isPending} className="w-full">
              {isPending ? 'Sending…' : 'Send Hello World'}
            </Button>
            {taskId && (
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                ✅ Task published! ID: <span className="font-mono">{taskId}</span>
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                ❌ {error}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
