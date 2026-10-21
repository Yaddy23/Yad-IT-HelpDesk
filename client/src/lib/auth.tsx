import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, apiErrorMessage, loadTokens, saveTokens, type SessionTokens } from './api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  employee: {
    id: string;
    employeeId: string;
    name: string;
    email: string;
    jobTitle: string | null;
    department: { id: string; name: string } | null;
    location: { id: string; name: string } | null;
    manager: { id: string; employeeId: string; name: string } | null;
  } | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

interface MeResponse {
  data: Omit<AuthUser, 'permissions'> & { permissions: string[] };
}
interface LoginResponse {
  data: {
    user: { id: string; email: string; name: string; roles: string[] };
    accessToken: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from a stored refresh token on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = loadTokens();
      if (!tokens?.refreshToken) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<MeResponse>('/auth/me');
        if (!cancelled) setUser(me.data.data);
      } catch {
        saveTokens(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    const session = res.data.data;
    const tokens: SessionTokens = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    };
    saveTokens(tokens);
    const me = await api.get<MeResponse>('/auth/me');
    setUser(me.data.data);
  }, []);

  const logout = useCallback(async () => {
    const tokens = loadTokens();
    try {
      if (tokens?.refreshToken) await api.post('/auth/logout', { refreshToken: tokens.refreshToken });
    } catch (err) {
      // Server-side revocation is best-effort; clear locally regardless.
      console.warn('logout call failed', apiErrorMessage(err));
    } finally {
      saveTokens(null);
      setUser(null);
    }
  }, []);

  const hasPermission = useCallback(
    (permission: string) => (user ? user.permissions.includes(permission) : false),
    [user],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) =>
      // An empty requirement list means "any signed-in user".
      user && permissions.length === 0
        ? true
        : user
          ? permissions.some((p) => user.permissions.includes(p))
          : false,
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, hasPermission, hasAnyPermission }),
    [user, loading, login, logout, hasPermission, hasAnyPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
