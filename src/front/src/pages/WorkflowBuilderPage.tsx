import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { workflowsService } from '@/services/workflowsService';
import { executionsService } from '@/services/executionsService';
import { filesService } from '@/services/filesService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

const MODEL_OPTIONS = [
  { value: 'htdemucs_ft', label: 'htdemucs_ft (fine-tuned, recommended)' },
  { value: 'htdemucs', label: 'htdemucs' },
  { value: 'mdx_extra', label: 'mdx_extra' },
  { value: 'UVR-MDX-NET-Inst_HQ_3', label: 'UVR-MDX-NET-Inst_HQ_3' },
];

const STEM_OPTIONS = ['vocals', 'drums', 'bass', 'other'];

const workflowSchema = z.object({
  name: z.string().min(1, 'Workflow name is required'),
  model: z.string().min(1, 'Model is required'),
  stems: z.array(z.string()).optional(),
});

type WorkflowFormValues = z.infer<typeof workflowSchema>;

export default function WorkflowBuilderPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileIdParam = searchParams.get('fileId');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, isLoading, navigate]);

  const { data: files = [] } = useQuery({
    queryKey: ['files'],
    queryFn: filesService.list,
    enabled: isAuthenticated,
  });

  const selectedFile = files.find((f) => f.id === fileIdParam);

  const form = useForm<WorkflowFormValues>({
    resolver: zodResolver(workflowSchema),
    defaultValues: {
      name: '',
      model: 'htdemucs_ft',
      stems: [],
    },
  });

  const createAndRunMutation = useMutation({
    mutationFn: async (values: WorkflowFormValues & { fileId: string }) => {
      const configJson = JSON.stringify({
        model: values.model,
        stems: values.stems && values.stems.length > 0 ? values.stems : undefined,
      });
      const workflow = await workflowsService.create({
        name: values.name,
        nodes: [{ order: 0, nodeType: 'AudioSeparation', configJson }],
      });
      const execution = await executionsService.start(workflow.id, values.fileId);
      return execution;
    },
    onSuccess: (execution) => {
      navigate(`/executions/${execution.id}`);
    },
  });

  const onSubmit = (values: WorkflowFormValues) => {
    const fileId = fileIdParam ?? selectedFileId;
    if (!fileId) {
      form.setError('name', { message: 'Please select a file first.' });
      return;
    }
    createAndRunMutation.mutate({ ...values, fileId });
  };

  const [selectedFileId, setSelectedFileId] = useState(fileIdParam ?? '');

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
          <Button variant="outline" size="sm" onClick={() => navigate('/files')}>
            ← My Files
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">New Workflow</h1>

        {createAndRunMutation.isError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            {(createAndRunMutation.error as Error).message ?? 'Something went wrong.'}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Configure</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Workflow name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workflow Name</FormLabel>
                      <FormControl>
                        <Input placeholder="My separation workflow" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Model */}
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {MODEL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Stems */}
                <Controller
                  control={form.control}
                  name="stems"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <Label>Stems (optional)</Label>
                      <div className="flex flex-wrap gap-4">
                        {STEM_OPTIONS.map((stem) => (
                          <label key={stem} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={field.value?.includes(stem) ?? false}
                              onChange={(e) => {
                                const current = field.value ?? [];
                                if (e.target.checked) {
                                  field.onChange([...current, stem]);
                                } else {
                                  field.onChange(current.filter((s) => s !== stem));
                                }
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="text-sm capitalize">{stem}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Leave empty to extract all stems.</p>
                    </div>
                  )}
                />

                {/* File selector */}
                <div className="space-y-2">
                  <Label>Audio File</Label>
                  {selectedFile ? (
                    <div className="flex items-center gap-2 p-3 rounded-md border bg-muted/30">
                      <span className="text-sm font-medium flex-1">{selectedFile.originalFileName}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/files')}
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={selectedFileId}
                        onChange={(e) => setSelectedFileId(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">— select a file —</option>
                        {files.map((f) => (
                          <option key={f.id} value={f.id}>{f.originalFileName}</option>
                        ))}
                      </select>
                      {files.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No files uploaded.{' '}
                          <button
                            type="button"
                            className="underline text-primary"
                            onClick={() => navigate('/files')}
                          >
                            Upload one first
                          </button>.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createAndRunMutation.isPending}
                >
                  {createAndRunMutation.isPending ? 'Starting…' : '⚡ Start Execution'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

