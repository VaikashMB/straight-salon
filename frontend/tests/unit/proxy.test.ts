// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '@/proxy';

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : {});

afterEach(() => vi.unstubAllEnvs());

describe('proxy.ts (05 §5)', () => {
  it('forwards /api/* to API_INTERNAL_URL read at request time, query string included', () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://backend:4000');
    const res = proxy(request('/api/v1/services?q=cut'));
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'http://backend:4000/api/v1/services?q=cut',
    );
    vi.stubEnv('API_INTERNAL_URL', 'http://other:5000');
    expect(proxy(request('/api/v1/auth/me')).headers.get('x-middleware-rewrite')).toBe(
      'http://other:5000/api/v1/auth/me',
    );
  });

  it('without API_INTERNAL_URL the API answers 503 problem+json', async () => {
    vi.stubEnv('API_INTERNAL_URL', '');
    const res = proxy(request('/api/v1/auth/me'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
  });

  it('signed-in areas need the ss_session cookie, else sign in with ?next', () => {
    for (const path of ['/account', '/staff/week', '/admin/reports?from=2026-10-01']) {
      const res = proxy(request(path));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('next')).toBe(path);
    }
    expect(proxy(request('/admin', 'ss_session=1')).headers.get('location')).toBeNull();
    expect(proxy(request('/accounting')).headers.get('location')).toBeNull();
  });

  it('runs only on the API and the signed-in areas', () => {
    expect(config.matcher).toEqual([
      '/api/:path*',
      '/account/:path*',
      '/staff/:path*',
      '/admin/:path*',
    ]);
  });
});
