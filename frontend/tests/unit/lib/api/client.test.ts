import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { apiOrigin, createApiClient, createAuthFetch, CSRF, unwrap } from '@/lib/api/client';
import { ApiError, NETWORK_ERROR } from '@/lib/errors';
import { api, problem, server } from '../../helpers/api';

const expired = () =>
  new Response(JSON.stringify({ code: 'TOKEN_EXPIRED', status: 401 }), {
    status: 401,
    headers: { 'content-type': 'application/problem+json' },
  });

function hooks(token: string | null, refreshed: string | null = 'fresh') {
  return {
    getToken: vi.fn(() => token),
    refresh: vi.fn(() => Promise.resolve(refreshed)),
    onUnauthenticated: vi.fn(),
  };
}

describe('auth fetch (05 §5)', () => {
  it('attaches the bearer token; no token, no header', async () => {
    const seen: (string | null)[] = [];
    const base = vi.fn((r: Request) => {
      seen.push(r.headers.get('authorization'));
      return Promise.resolve(new Response('{}'));
    });
    await createAuthFetch(hooks('abc'), base)(new Request('http://x/a'));
    await createAuthFetch(hooks(null), base)(new Request('http://x/a'));
    expect(seen).toEqual(['Bearer abc', null]);
  });

  it('on 401 TOKEN_EXPIRED refreshes once and retries the original request with its body', async () => {
    const h = hooks('old');
    const bodies: string[] = [];
    const base = vi.fn(async (r: Request) => {
      bodies.push(await r.text());
      return r.headers.get('authorization') === 'Bearer old' ? expired() : new Response('ok');
    });
    const res = await createAuthFetch(
      h,
      base,
    )(new Request('http://x/a', { method: 'POST', body: '{"a":1}' }));
    expect(await res.text()).toBe('ok');
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(bodies).toEqual(['{"a":1}', '{"a":1}']);
    expect(h.onUnauthenticated).not.toHaveBeenCalled();
  });

  it('refresh failure signs out and returns the original 401', async () => {
    const h = hooks('old', null);
    const res = await createAuthFetch(h, () => Promise.resolve(expired()))(
      new Request('http://x/a'),
    );
    expect(res.status).toBe(401);
    expect(h.onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('other 401s (and anonymous requests) are passed through without a refresh', async () => {
    const h = hooks('old');
    const unauthenticated = new Response(JSON.stringify({ code: 'UNAUTHENTICATED' }), {
      status: 401,
    });
    await createAuthFetch(h, () => Promise.resolve(unauthenticated))(new Request('http://x/a'));
    await createAuthFetch(h, () => Promise.resolve(new Response('not json', { status: 401 })))(
      new Request('http://x/a'),
    );
    const anon = hooks(null);
    await createAuthFetch(anon, () => Promise.resolve(expired()))(new Request('http://x/a'));
    expect(h.refresh).not.toHaveBeenCalled();
    expect(anon.refresh).not.toHaveBeenCalled();
  });
});

describe('typed client and unwrap', () => {
  it('calls the page origin and resolves data', async () => {
    expect(apiOrigin()).toBe('http://localhost:3000');
    const client = createApiClient();
    const settings = await unwrap(client.GET('/api/v1/settings/public'));
    expect(settings.timezone).toBe('Asia/Kolkata');
  });

  it('sends the CSRF header on auth calls (06 §4)', async () => {
    let header: string | null = null;
    server.use(
      http.post(api('/auth/forgot-password'), ({ request }) => {
        header = request.headers.get('x-requested-with');
        return new HttpResponse(null, { status: 202 });
      }),
    );
    await unwrap(
      createApiClient().POST('/api/v1/auth/forgot-password', {
        params: CSRF,
        body: { email: 'a@b.co' },
      }),
    );
    expect(header).toBe('straight-salon-web');
  });

  it('throws ApiError for problems and network failures', async () => {
    server.use(http.get(api('/settings/public'), () => problem(503, 'TEMPORARILY_UNAVAILABLE')));
    const err = await unwrap(createApiClient().GET('/api/v1/settings/public')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE', status: 503 });

    const offline = createApiClient({ fetch: () => Promise.reject(new TypeError('offline')) });
    await expect(unwrap(offline.GET('/api/v1/settings/public'))).rejects.toMatchObject({
      code: NETWORK_ERROR,
    });
  });
});
