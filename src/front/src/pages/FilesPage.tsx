import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { filesService } from '@/services/filesService';
import { Button } from '@/components/ui/button';
import { AppHeader } from '@/components/layout/AppHeader';
import { FileUploadZone } from '@/components/files/FileUploadZone';
import { FileTable } from '@/components/files/FileTable';
import type { FileRecord } from '@/types/file';

export default function FilesPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/login');
  }, [isAuthenticated, isLoading, navigate]);

  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ['files'],
    queryFn: filesService.list,
    enabled: isAuthenticated,
  });

  const uploadMutation = useMutation({
    mutationFn: filesService.upload,
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setUploadSuccess(`"${file.originalFileName}" uploaded successfully.`);
      setUploadError(null);
      setTimeout(() => setUploadSuccess(null), 4000);
    },
    onError: (err: Error) => {
      setUploadError(err.message ?? 'Upload failed.');
      setUploadSuccess(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: filesService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    uploadMutation.mutate(fileList[0]);
  }, [uploadMutation]);

  const handleDelete = (file: FileRecord) => {
    if (window.confirm(`Delete "${file.originalFileName}"?`)) {
      deleteMutation.mutate(file.id);
    }
  };

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
        <h1 className="text-3xl font-bold tracking-tight">My Audio Files</h1>

        <FileUploadZone
          isUploading={uploadMutation.isPending}
          isDragging={isDragging}
          successMessage={uploadSuccess}
          errorMessage={uploadError}
          onFilesSelected={handleFiles}
          onDragStateChange={setIsDragging}
        />

        <FileTable
          files={files}
          isLoading={filesLoading}
          isDeleting={deleteMutation.isPending}
          onDelete={handleDelete}
          onRunWorkflow={(fileId) => navigate(`/workflows/new?fileId=${fileId}`)}
        />
      </main>
    </div>
  );
}
