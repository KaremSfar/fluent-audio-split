import { useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface FileUploadZoneProps {
  isUploading: boolean;
  isDragging: boolean;
  accept?: string;
  successMessage?: string | null;
  errorMessage?: string | null;
  onFilesSelected: (files: FileList | null) => void;
  onDragStateChange: (isDragging: boolean) => void;
}

export function FileUploadZone({
  isUploading,
  isDragging,
  accept = '.wav,.mp3,.flac,.aiff',
  successMessage,
  errorMessage,
  onFilesSelected,
  onDragStateChange,
}: FileUploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDragStateChange(false);
    onFilesSelected(e.dataTransfer.files);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            onDragStateChange(true);
          }}
          onDragLeave={() => onDragStateChange(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => onFilesSelected(e.target.files)}
          />
          {isUploading ? (
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
        {successMessage && (
          <p className="mt-3 text-sm text-green-600 font-medium">{successMessage}</p>
        )}
        {errorMessage && (
          <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
