import apiClient from '@/services/apiClient';
import type { LoginRequest, RegisterRequest, AuthResponse } from '@/types/auth';

export async function login(req: LoginRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/login', req);
  return response.data;
}

export async function register(req: RegisterRequest): Promise<void> {
  await apiClient.post('/auth/register', req);
}

export function logout(): void {
  localStorage.removeItem('auth_token');
}
