import { createApiClient, CSRF, type ApiClient } from '../api/client';
import { singleFlight } from './single-flight';

// The browser session outside React (05 §5): the access token in memory only (never storage),
// the single-flight refresh, and two clients: `publicApi` for the auth endpoints and `api`,
// which adds the bearer token and refreshes once on 401 TOKEN_EXPIRED. The refresh token itself
// is the httpOnly ss_rt cookie, which only the API reads.

export interface Session {
  publicApi: ApiClient;
  api: ApiClient;
  // A new access token from the refresh cookie, or null when there is no session.
  refresh(this: void): Promise<string | null>;
  getToken(this: void): string | null;
  setToken(this: void, token: string | null): void;
  // Called when the session ended under us (refresh failed after an expired token).
  onExpired(this: void, listener: () => void): () => void;
}

export function createSession(options: { baseUrl?: string } = {}): Session {
  let token: string | null = null;
  const listeners = new Set<() => void>();
  const base = options.baseUrl ? { baseUrl: options.baseUrl } : {};

  const publicApi = createApiClient(base);
  const refresh = singleFlight(async () => {
    const { data } = await publicApi
      .POST('/api/v1/auth/refresh', { params: CSRF })
      .catch(() => ({ data: undefined }));
    token = data?.accessToken ?? null;
    return token;
  });
  const api = createApiClient({
    ...base,
    hooks: {
      getToken: () => token,
      refresh,
      onUnauthenticated: () => {
        token = null;
        for (const listener of listeners) listener();
      },
    },
  });

  return {
    publicApi,
    api,
    refresh,
    getToken: () => token,
    setToken: (value) => {
      token = value;
    },
    onExpired: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
