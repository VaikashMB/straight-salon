import createClient from 'openapi-fetch';
import { ApiError, NETWORK_ERROR, toProblem } from '../errors';
import type { components, paths } from './schema';

// Typed API client (05 §1, §5) generated from backend/openapi.json (`npm run api:client`). The
// browser only ever talks to its own origin: proxy.ts forwards /api/* to the backend, so the
// refresh cookie stays first-party. Paths carry the API base path (/api/v1) from the contract.

export type ApiClient = ReturnType<typeof createClient<paths>>;
export type Schemas = components['schemas'];

// 06 §4: every POST /auth/* requires this header. The contract declares it as a header
// parameter, so the typed client makes each auth call pass it: `{ params: CSRF }`.
export const CSRF = { header: { 'x-requested-with': 'straight-salon-web' } } as const;

// What the client needs from the auth layer.
export interface AuthHooks {
  getToken(): string | null;
  // Single-flight refresh (05 §5); the new access token, or null if the session is gone.
  refresh(): Promise<string | null>;
  // Refresh failed after an expired token: clear state and send the user to sign in.
  onUnauthenticated(): void;
}

async function isTokenExpired(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body.code === 'TOKEN_EXPIRED';
  } catch {
    return false;
  }
}

function withToken(request: Request, token: string | null): Request {
  if (!token) return request;
  const authorised = new Request(request);
  authorised.headers.set('Authorization', `Bearer ${token}`);
  return authorised;
}

// fetch for openapi-fetch: attaches the bearer token; on 401 TOKEN_EXPIRED refreshes once and
// retries the original request; if the refresh fails, signs out. `baseFetch` is resolved per call
// so test interceptors installed later still apply.
export function createAuthFetch(
  hooks: AuthHooks,
  baseFetch: (request: Request) => Promise<Response> = (r) => globalThis.fetch(r),
): (request: Request) => Promise<Response> {
  return async (request) => {
    const token = hooks.getToken();
    const retry = token ? request.clone() : null;
    const response = await baseFetch(withToken(request, token));
    if (!retry || !(await isTokenExpired(response))) return response;
    const fresh = await hooks.refresh();
    if (!fresh) {
      hooks.onUnauthenticated();
      return response;
    }
    return baseFetch(withToken(retry, fresh));
  };
}

export function apiOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
}

export function createApiClient(
  options: { hooks?: AuthHooks; baseUrl?: string; fetch?: (r: Request) => Promise<Response> } = {},
): ApiClient {
  const baseFetch = options.fetch ?? ((r: Request) => globalThis.fetch(r));
  return createClient<paths>({
    baseUrl: options.baseUrl ?? apiOrigin(),
    credentials: 'same-origin',
    fetch: options.hooks ? createAuthFetch(options.hooks, baseFetch) : baseFetch,
  });
}

// Resolves to `data`, or throws ApiError for problem responses and network failures, so callers
// (and TanStack Query) handle one error type.
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch {
    throw new ApiError({ status: 0, code: NETWORK_ERROR });
  }
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(toProblem(result.error, result.response));
  }
  return result.data as T;
}
