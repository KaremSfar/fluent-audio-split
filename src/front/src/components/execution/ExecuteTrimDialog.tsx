import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { filesService } from '@/services/filesService';
import { sha256Hex } from '@/lib/hashFile';
import { TrimWaveform, type TrimWaveformHandle } from '@/components/execution/TrimWaveform';
import type { FileRecord } from '@/types/file';

interface ExecuteTrimDialogProps {
  onExecute: (args: { fileId: string; trimStart?: number; trimEnd?: number }) => void;
  onClose: () => void;
  isPending: boolean;
}

type UploadPhase = 'idle' | 'hashing' | 'checking' | 'uploading' | 'ready' | 'error';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function ExecuteTrimDialog({ onExecute, onClose, isPending }: ExecuteTrimDialogProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileRecord, setFileRecord] = useState<FileRecord | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [wasReused, setWasReused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [waveformError, setWaveformError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<TrimWaveformHandle>(null);

  const resetToDropzone = useCallback(() => {
    setPickedFile(null);
    setFileRecord(null);
    setUploadPhase('idle');
    setWasReused(false);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setWaveformError(false);
  }, []);

  const handleFileSelected = useCallback((fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setPickedFile(file);
    setFileRecord(null);
    setWasReused(false);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setWaveformError(false);
  }, []);

  // Upload/dedup flow — runs in parallel with the client-side waveform decode.
  useEffect(() => {
    if (!pickedFile) return;
    let cancelled = false;

    (async () => {
      try {
        setUploadPhase('hashing');
        const hash = await sha256Hex(pickedFile);
        if (cancelled) return;
        setUploadPhase('checking');
        const existing = await filesService.findByHash(hash);
        if (cancelled) return;
        if (existing) {
          setFileRecord(existing);
          setWasReused(true);
          setUploadPhase('ready');
          return;
        }
        setUploadPhase('uploading');
        const uploaded = await filesService.upload(pickedFile);
        if (cancelled) return;
        setFileRecord(uploaded);
        setWasReused(false);
        setUploadPhase('ready');
      } catch {
        if (!cancelled) setUploadPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pickedFile, retryToken]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelected(e.dataTransfer.files);
  };

  const handleTrimStartChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clamped = Math.max(0, Math.min(value, trimEnd));
    setTrimStart(clamped);
    waveformRef.current?.setRegion(clamped, trimEnd);
  };

  const handleTrimEndChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clamped = Math.min(duration, Math.max(value, trimStart));
    setTrimEnd(clamped);
    waveformRef.current?.setRegion(trimStart, clamped);
  };

  const handleResetSelection = () => {
    setTrimStart(0);
    setTrimEnd(duration);
    waveformRef.current?.setRegion(0, duration);
  };

  const statusLine = (() => {
    switch (uploadPhase) {
      case 'hashing':
        return { text: 'Hashing file…', className: 'text-muted-foreground' };
      case 'checking':
        return { text: 'Checking for a previous upload…', className: 'text-muted-foreground' };
      case 'uploading':
        return { text: 'Uploading…', className: 'text-muted-foreground' };
      case 'ready':
        return {
          text: wasReused ? 'Ready ✓ (reused previous upload)' : 'Ready ✓',
          className: 'text-green-600',
        };
      case 'error':
        return { text: 'Upload failed', className: 'text-red-600' };
      default:
        return null;
    }
  })();

  const isFullFile = waveformError || (trimStart === 0 && trimEnd === duration);
  const canRun = uploadPhase === 'ready' && !isPending && (waveformError || trimStart < trimEnd);

  const handleRun = () => {
    if (!fileRecord) return;
    onExecute({
      fileId: fileRecord.id,
      trimStart: isFullFile ? undefined : trimStart,
      trimEnd: isFullFile ? undefined : trimEnd,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-2xl mx-4">
        <CardHeader>
          <CardTitle>Run Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pickedFile ? (
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => handleFileSelected(e.target.files)}
              />
              <div className="space-y-2">
                <p className="text-2xl">🎵</p>
                <p className="font-medium">Drop an audio file here or click to browse</p>
                <p className="text-sm text-muted-foreground">Any audio format your browser can decode</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{pickedFile.name}</p>
                <button
                  type="button"
                  onClick={resetToDropzone}
                  className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                >
                  Change file
                </button>
              </div>

              {waveformError ? (
                <p className="text-sm text-muted-foreground">
                  Preview unavailable for this file format — you can still run with the full file.
                </p>
              ) : (
                <TrimWaveform
                  ref={waveformRef}
                  file={pickedFile}
                  onDuration={(d) => {
                    setDuration(d);
                    setTrimEnd(d);
                  }}
                  onSelectionChange={(s, e) => {
                    setTrimStart(s);
                    setTrimEnd(e);
                  }}
                  onDecodeError={() => setWaveformError(true)}
                />
              )}

              {statusLine && (
                <p className={`text-sm flex items-center gap-2 ${statusLine.className}`}>
                  {statusLine.text}
                  {uploadPhase === 'error' && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-red-600 underline"
                      onClick={() => setRetryToken((t) => t + 1)}
                    >
                      Retry upload
                    </Button>
                  )}
                </p>
              )}

              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="trim-start">Start ({formatTime(trimStart)})</Label>
                  <Input
                    id="trim-start"
                    type="number"
                    step="0.1"
                    min="0"
                    value={trimStart}
                    disabled={waveformError}
                    onChange={(e) => handleTrimStartChange(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="trim-end">End ({formatTime(trimEnd)})</Label>
                  <Input
                    id="trim-end"
                    type="number"
                    step="0.1"
                    min="0"
                    value={trimEnd}
                    disabled={waveformError}
                    onChange={(e) => handleTrimEndChange(Number(e.target.value))}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleResetSelection} disabled={waveformError}>
                  Reset selection
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button disabled={!canRun} onClick={handleRun}>
              {isPending ? 'Starting…' : '⚡ Run'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
