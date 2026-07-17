import axios from 'axios';
import apiClient from './apiClient';
import type { FileRecord } from '../types/file';

export const filesService = {
  upload: async (file: File): Promise<FileRecord> => {
    const formData = new FormData();
    formData.append('file', file);
    // Do NOT set Content-Type manually — axios detects FormData and adds the correct
    // multipart/form-data; boundary=... header automatically.
    const { data } = await apiClient.post<FileRecord>('/files/upload', formData);
    return data;
  },
  importYouTube: async (url: string): Promise<FileRecord> => {
    const { data } = await apiClient.post<FileRecord>('/files/import-youtube', { url });
    return data;
  },
  getContentAsFile: async (fileRecord: FileRecord): Promise<File> => {
    const { data } = await apiClient.get<Blob>(`/files/${fileRecord.id}/content`, {
      responseType: 'blob',
    });
    return new File([data], fileRecord.originalFileName, {
      type: data.type || fileRecord.contentType,
    });
  },
  findByHash: async (hash: string): Promise<FileRecord | null> => {
    try {
      const { data } = await apiClient.get<FileRecord>(`/files/by-hash/${hash}`);
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  },
  download: async (relativePath: string, fileName?: string): Promise<void> => {
    const token = localStorage.getItem('auth_token');
    const base = import.meta.env.VITE_SERVICE_URL ?? 'http://localhost:5001';
    const url = `${base}/api/files/download?path=${encodeURIComponent(relativePath)}`;

    const response = await fetch(url, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    });

    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName ?? relativePath.split('/').pop() ?? 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  },
};
