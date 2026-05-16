import apiClient from '@/services/apiClient';
import type { LoginRequest, RegisterRequest, AuthResponse } from '@/types/auth';

export async function login(req: LoginRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/login', req);
  return response.data;
}

export async function refreshToken(): Promise<AuthResponse> {
  const token = localStorage.getItem('auth_refresh_token');
  if (!token) throw new Error('No refresh token');
  const response = await apiClient.post<AuthResponse>('/auth/refresh', { refreshToken: token });
  return response.data;
}

export async function register(req: RegisterRequest): Promise<void> {
  await apiClient.post('/auth/register', req);
}

export function logout(): void {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_refresh_token');
}
