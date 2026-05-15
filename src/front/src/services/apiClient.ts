import axios from 'axios';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_SERVICE_URL ?? 'http://localhost:5001',
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default apiClient;
