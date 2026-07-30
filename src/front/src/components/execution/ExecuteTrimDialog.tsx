import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { filesService } from '@/services/filesService';
import { sha256Hex } from '@/lib/hashFile';
import { TrimWaveform, type TrimWaveformHandle } from '@/components/execution/TrimWaveform';
import type { FileRecord } from '@/types/file';
import { isAxiosError } from 'axios';
import { Download } from 'lucide-react';

interface ExecuteTrimDialogProps {
  onExecute: (args: { fileId: string; trimStart?: number; trimEnd?: number }) => void;
  onClose: () => void;
  isPending: boolean;
}

type UploadPhase = 'idle' | 'hashing' | 'checking' | 'uploading' | 'ready' | 'error';
type InputSource = 'local' | 'youtube';

// Formats seconds as an editable m:ss(.ss) time string, e.g. 42.23 -> "0:42.23".
function formatTimeInput(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const wholeSecs = Math.floor(secs);
  const fraction = secs - wholeSecs;
  const fractionStr = fraction > 0 ? fraction.toFixed(2).slice(1).replace(/0+$/, '').replace(/\.$/, '') : '';
  return `${mins}:${String(wholeSecs).padStart(2, '0')}${fractionStr}`;
}

// Parses an m:ss / mm:ss.ss / plain-seconds string into seconds, or null if invalid.
function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || mins < 0 || secs < 0) return null;
    return mins * 60 + secs;
  }
  const secs = Number(parts[0]);
  return Number.isFinite(secs) && secs >= 0 ? secs : null;
}

export function ExecuteTrimDialog({ onExecute, onClose, isPending }: ExecuteTrimDialogProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [inputSource, setInputSource] = useState<InputSource | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileRecord, setFileRecord] = useState<FileRecord | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [wasReused, setWasReused] = useState(false);
  const [youTubeUrl, setYouTubeUrl] = useState('');
  const [isImportingYouTube, setIsImportingYouTube] = useState(false);
  const [youTubeError, setYouTubeError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimStartText, setTrimStartText] = useState(formatTimeInput(0));
  const [trimEndText, setTrimEndText] = useState(formatTimeInput(0));
  const [committedTrimStart, setCommittedTrimStart] = useState(0);
  const [committedTrimEnd, setCommittedTrimEnd] = useState(0);
  const [waveformError, setWaveformError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<TrimWaveformHandle>(null);

  const resetToDropzone = useCallback(() => {
    setPickedFile(null);
    setInputSource(null);
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
    setInputSource('local');
    setFileRecord(null);
    setUploadPhase('idle');
    setWasReused(false);
    setYouTubeError(null);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setWaveformError(false);
  }, []);

  // Upload/dedup flow — runs in parallel with the client-side waveform decode.
  useEffect(() => {
    if (!pickedFile || inputSource !== 'local') return;
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
  }, [inputSource, pickedFile, retryToken]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelected(e.dataTransfer.files);
  };

  const handleYouTubeImport = async () => {
    const url = youTubeUrl.trim();
    if (!url) {
      setYouTubeError('Paste a YouTube video URL to continue.');
      return;
    }

    setYouTubeError(null);
    setIsImportingYouTube(true);
    try {
      const importedFileRecord = await filesService.importYouTube(url);
      const importedFile = await filesService.getContentAsFile(importedFileRecord);
      setInputSource('youtube');
      setPickedFile(importedFile);
      setFileRecord(importedFileRecord);
      setUploadPhase('ready');
      setWasReused(false);
      setDuration(0);
      setTrimStart(0);
      setTrimEnd(0);
      setWaveformError(false);
    } catch (error) {
      const message = isAxiosError(error) && typeof error.response?.data === 'string'
        ? error.response.data
        : 'Unable to import audio from that YouTube video.';
      setYouTubeError(message);
    } finally {
      setIsImportingYouTube(false);
    }
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

  // Keep the editable time text in sync whenever the trim bounds change from
  // elsewhere (waveform drag, reset, initial load) — but not while the user
  // is actively typing, since that's handled locally until commit. Resetting
  // state during render (instead of in an effect) avoids an extra render pass.
  if (trimStart !== committedTrimStart) {
    setCommittedTrimStart(trimStart);
    setTrimStartText(formatTimeInput(trimStart));
  }

  if (trimEnd !== committedTrimEnd) {
    setCommittedTrimEnd(trimEnd);
    setTrimEndText(formatTimeInput(trimEnd));
  }

  const commitTrimStartText = () => {
    const parsed = parseTimeInput(trimStartText);
    if (parsed === null) {
      setTrimStartText(formatTimeInput(trimStart));
      return;
    }
    handleTrimStartChange(parsed);
  };

  const commitTrimEndText = () => {
    const parsed = parseTimeInput(trimEndText);
    if (parsed === null) {
      setTrimEndText(formatTimeInput(trimEnd));
      return;
    }
    handleTrimEndChange(parsed);
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
            <div className="space-y-5">
              <div
                className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                  isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
                }`}
                onClick={() => !isImportingYouTube && fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isImportingYouTube) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  if (!isImportingYouTube) handleDrop(e);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  disabled={isImportingYouTube}
                  onChange={(e) => handleFileSelected(e.target.files)}
                />
                <div className="space-y-2">
                  <p className="text-2xl">🎵</p>
                  <p className="font-medium">Drop an audio file here or click to browse</p>
                  <p className="text-sm text-muted-foreground">Any audio format your browser can decode</p>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-3 text-muted-foreground">Or paste a YouTube URL</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtube-url">YouTube video URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="youtube-url"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youTubeUrl}
                    disabled={isImportingYouTube}
                    onChange={(e) => setYouTubeUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleYouTubeImport();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => void handleYouTubeImport()}
                    disabled={isImportingYouTube || !youTubeUrl.trim()}
                  >
                    <Download className="size-4" />
                    {isImportingYouTube ? 'Importing…' : 'Import'}
                  </Button>
                </div>
                {isImportingYouTube && (
                  <p className="text-sm text-muted-foreground">Downloading and preparing an MP3 preview…</p>
                )}
                {youTubeError && <p className="text-sm text-red-600">{youTubeError}</p>}
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
                  <Label htmlFor="trim-start">Start</Label>
                  <Input
                    id="trim-start"
                    type="text"
                    inputMode="numeric"
                    placeholder="m:ss"
                    className="w-24"
                    value={trimStartText}
                    disabled={waveformError}
                    onChange={(e) => setTrimStartText(e.target.value)}
                    onBlur={commitTrimStartText}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="trim-end">End</Label>
                  <Input
                    id="trim-end"
                    type="text"
                    inputMode="numeric"
                    placeholder="m:ss"
                    className="w-24"
                    value={trimEndText}
                    disabled={waveformError}
                    onChange={(e) => setTrimEndText(e.target.value)}
                    onBlur={commitTrimEndText}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
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
