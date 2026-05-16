import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { filesService } from '@/services/filesService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { FileRecord } from '@/types/file';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function FilesPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

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
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80">
              <span className="text-xl">🎵</span>
              <span className="font-semibold text-foreground">Fluent Audio Split</span>
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
            ← Dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">My Audio Files</h1>

        {/* Upload zone */}
        <Card>
          <CardContent className="pt-6">
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,.flac,.aiff"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {uploadMutation.isPending ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">Uploading…</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-2xl">🎵</p>
                  <p className="font-medium">Drop an audio file here or click to browse</p>
                  <p className="text-sm text-muted-foreground">WAV, MP3, FLAC, AIFF supported</p>
                </div>
              )}
            </div>
            {uploadSuccess && (
              <p className="mt-3 text-sm text-green-600 font-medium">{uploadSuccess}</p>
            )}
            {uploadError && (
              <p className="mt-3 text-sm text-red-600">{uploadError}</p>
            )}
          </CardContent>
        </Card>

        {/* File list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Uploaded Files</span>
              <Badge variant="secondary">{files.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filesLoading ? (
              <p className="text-muted-foreground py-4 text-center">Loading files…</p>
            ) : files.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center">No files uploaded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="font-medium">{file.originalFileName}</TableCell>
                      <TableCell>{formatBytes(file.sizeBytes)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(file.createdAt)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/workflows/new?fileId=${file.id}`)}
                        >
                          Run Workflow →
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(file)}
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </Button>
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
