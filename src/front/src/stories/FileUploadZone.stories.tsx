import type { Meta, StoryObj } from '@storybook/react';
import { FileUploadZone } from '@/components/files/FileUploadZone';

const meta: Meta<typeof FileUploadZone> = {
  title: 'Files/FileUploadZone',
  component: FileUploadZone,
  args: {
    isUploading: false,
    isDragging: false,
    onFilesSelected: (files) => console.log('Files selected:', files),
    onDragStateChange: (isDragging) => console.log('Dragging:', isDragging),
  },
};

export default meta;
type Story = StoryObj<typeof FileUploadZone>;

export const Default: Story = {};

export const Uploading: Story = {
  args: {
    isUploading: true,
  },
};

export const Dragging: Story = {
  args: {
    isDragging: true,
  },
};

export const WithSuccess: Story = {
  args: {
    successMessage: '"my-audio-file.wav" uploaded successfully.',
  },
};

export const WithError: Story = {
  args: {
    errorMessage: 'Upload failed. Please try again.',
  },
};
