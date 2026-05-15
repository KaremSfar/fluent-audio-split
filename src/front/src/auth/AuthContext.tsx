import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { login as loginService, register as registerService, logout as logoutService } from './authService';
import type { LoginRequest, RegisterRequest, User } from '@/types/auth';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (req: LoginRequest) => Promise<void>;
  register: (req: RegisterRequest) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  login: async () => {},
  register: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const email = localStorage.getItem('auth_email');
    if (token && email) {
      setUser({ email });
    }
    setIsLoading(false);
  }, []);

  const loginMutation = useMutation({
    mutationFn: loginService,
    onSuccess: (data, variables) => {
      localStorage.setItem('auth_token', data.accessToken);
      localStorage.setItem('auth_email', variables.email);
      setUser({ email: variables.email });
    },
  });

  const registerMutation = useMutation({
    mutationFn: registerService,
  });

  const login = useCallback(async (req: LoginRequest) => {
    await loginMutation.mutateAsync(req);
  }, [loginMutation]);

  const register = useCallback(async (req: RegisterRequest) => {
    await registerMutation.mutateAsync(req);
  }, [registerMutation]);

  const logout = useCallback(() => {
    logoutService();
    localStorage.removeItem('auth_email');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
