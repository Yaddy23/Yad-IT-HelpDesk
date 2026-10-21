import axios, { type AxiosError } from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

const TOKEN_KEY = 'itsm.tokens';

export function loadTokens(): SessionTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as SessionTokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: SessionTokens | null): void {
  try {
    if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode etc.) — session lives for the tab only.
  }
}

api.interceptors.request.use((config) => {
  const tokens = loadTokens();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

type RetryConfig = { _retry?: boolean };

let refreshInFlight: Promise<SessionTokens | null> | null = null;

/** Single-flight refresh: concurrent 401s wait on one refresh call. */
function refreshTokens(): Promise<SessionTokens | null> {
  refreshInFlight ??= (async () => {
    const current = loadTokens();
    if (!current?.refreshToken) return null;
    try {
      const res = await axios.post<ApiEnvelope<SessionTokens>>(
        '/api/v1/auth/refresh',
        { refreshToken: current.refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      saveTokens(res.data.data);
      return res.data.data;
    } catch {
      saveTokens(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// 401 → try one refresh, then replay the original request.
api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<ApiError>) => {
    const config = err.config as (typeof err.config & RetryConfig) | undefined;
    const url = config?.url ?? '';
    const isAuthCall = url.includes('/auth/refresh') || url.includes('/auth/login');

    if (err.response?.status === 401 && config && !config._retry && !isAuthCall) {
      config._retry = true;
      const tokens = await refreshTokens();
      if (tokens) {
        config.headers.Authorization = `Bearer ${tokens.accessToken}`;
        return api.request(config);
      }
      window.location.assign('/login');
    }
    return Promise.reject(err);
  },
);

/** Extracts the server's readable message from an error response. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<ApiError>(err)) {
    return err.response?.data?.error?.message ?? err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
