import React, { createContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { login as loginService, register as registerService, logout as logoutService, refreshToken as refreshTokenService } from './authService';
import type { LoginRequest, RegisterRequest, User, AuthResponse } from '@/types/auth';

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
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Refresh at 80% of token lifetime
    const delay = Math.max((expiresIn * 0.8) * 1000, 10_000);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const data = await refreshTokenService();
        localStorage.setItem('auth_token', data.accessToken);
        localStorage.setItem('auth_refresh_token', data.refreshToken);
        scheduleRefresh(data.expiresIn);
      } catch {
        logoutService();
        localStorage.removeItem('auth_email');
        setUser(null);
      }
    }, delay);
  }, []);

  const handleAuthSuccess = useCallback((data: AuthResponse, email: string) => {
    localStorage.setItem('auth_token', data.accessToken);
    localStorage.setItem('auth_refresh_token', data.refreshToken);
    localStorage.setItem('auth_email', email);
    setUser({ email });
    scheduleRefresh(data.expiresIn);
  }, [scheduleRefresh]);

  useEffect(() => {
    const token = localStorage.getItem('auth_refresh_token');
    const email = localStorage.getItem('auth_email');
    if (token && email) {
      refreshTokenService()
        .then((data) => {
          handleAuthSuccess(data, email);
        })
        .catch(() => {
          logoutService();
          localStorage.removeItem('auth_email');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [handleAuthSuccess]);

  const loginMutation = useMutation({
    mutationFn: loginService,
    onSuccess: (data, variables) => {
      handleAuthSuccess(data, variables.email);
    },
  });

  const registerMutation = useMutation({
    mutationFn: registerService,
  });

  // Destructure only the stable mutateAsync functions so the useCallbacks below
  // don't recreate whenever mutation status changes (idle → pending → success).
  const { mutateAsync: loginMutateAsync } = loginMutation;
  const { mutateAsync: registerMutateAsync } = registerMutation;

  const login = useCallback(async (req: LoginRequest) => {
    await loginMutateAsync(req);
  }, [loginMutateAsync]);

  const register = useCallback(async (req: RegisterRequest) => {
    await registerMutateAsync(req);
  }, [registerMutateAsync]);

  const logout = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    logoutService();
    localStorage.removeItem('auth_email');
    setUser(null);
  }, []);

  const contextValue = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
  }), [user, isLoading, login, register, logout]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
