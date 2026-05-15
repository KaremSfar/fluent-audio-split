import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { workflowsService } from '@/services/workflowsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

const schema = z.object({
  name: z.string().min(1, 'Give your workflow a name'),
});
type FormValues = z.infer<typeof schema>;

export default function NewWorkflowPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, isLoading, navigate]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      workflowsService.create({
        name,
        // Start with a default AudioSeparation node (model will be configured on canvas)
        nodes: [{ order: 0, nodeType: 'AudioSeparation', configJson: JSON.stringify({ modelName: 'htdemucs_ft' }) }],
      }),
    onSuccess: (workflow) => navigate(`/workflows/${workflow.id}`),
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80">
            <span className="text-xl">🎵</span>
            <span className="font-semibold">Fluent Audio Split</span>
          </button>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>← Dashboard</Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">New Workflow</CardTitle>
            <CardDescription>Give your workflow a name to get started. You'll configure the nodes on the canvas.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => createMutation.mutate(v.name))}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workflow name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Vocal extraction" autoFocus {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {createMutation.isError && (
                  <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
                )}

                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create workflow →'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
