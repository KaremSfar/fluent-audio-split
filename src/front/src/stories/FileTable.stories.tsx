import type { Meta, StoryObj } from '@storybook/react';
import { FileTable } from '@/components/files/FileTable';
import type { FileRecord } from '@/types/file';

const mockFiles: FileRecord[] = [
  {
    id: '1',
    originalFileName: 'song.wav',
    contentType: 'audio/wav',
    sizeBytes: 5242880,
    createdAt: '2026-05-25T10:30:00Z',
  },
  {
    id: '2',
    originalFileName: 'podcast-episode.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 12582912,
    createdAt: '2026-05-24T14:20:00Z',
  },
  {
    id: '3',
    originalFileName: 'recording.flac',
    contentType: 'audio/flac',
    sizeBytes: 31457280,
    createdAt: '2026-05-23T09:15:00Z',
  },
];

const meta: Meta<typeof FileTable> = {
  title: 'Files/FileTable',
  component: FileTable,
  args: {
    files: mockFiles,
    isLoading: false,
    isDeleting: false,
    onDelete: (file) => console.log('Delete:', file),
    onRunWorkflow: (fileId) => console.log('Run workflow for:', fileId),
  },
};

export default meta;
type Story = StoryObj<typeof FileTable>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    files: [],
  },
};
