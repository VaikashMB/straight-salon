import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { unwrap } from '@/lib/api/client';
import { createSession } from '@/lib/auth/session';
import { api, makeUser, problem, server } from '../../helpers/api';

// /auth/me that only accepts `valid`; an expired token gets TOKEN_EXPIRED.
function meAccepting(valid: string) {
  server.use(
    http.get(api('/auth/me'), ({ request }) =>
      request.headers.get('authorization') === `Bearer ${valid}`
        ? HttpResponse.json(makeUser())
        : problem(401, 'TOKEN_EXPIRED'),
    ),
  );
}

describe('session (05 §5)', () => {
  it('refresh stores the new access token for the authenticated client', async () => {
    server.use(http.post(api('/auth/refresh'), () => HttpResponse.json({ accessToken: 't1' })));
    meAccepting('t1');
    const session = createSession();
    expect(await session.refresh()).toBe('t1');
    expect((await unwrap(session.api.GET('/api/v1/auth/me'))).name).toBe('Ananya Rao');
  });

  it('parallel requests with an expired token share ONE refresh, then all succeed', async () => {
    let refreshes = 0;
    server.use(
      http.post(api('/auth/refresh'), async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return HttpResponse.json({ accessToken: 'fresh' });
      }),
    );
    meAccepting('fresh');
    const session = createSession();
    session.setToken('stale');
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => unwrap(session.api.GET('/api/v1/auth/me'))),
    );
    expect(results).toHaveLength(5);
    expect(refreshes).toBe(1);
  });

  it('a failed refresh after expiry notifies listeners and clears the token', async () => {
    meAccepting('never');
    const session = createSession();
    session.setToken('stale');
    const listener = vi.fn();
    const unsubscribe = session.onExpired(listener);
    await expect(unwrap(session.api.GET('/api/v1/auth/me'))).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    await unwrap(session.api.GET('/api/v1/auth/me')).catch(() => undefined);
    expect(listener).toHaveBeenCalledOnce(); // no token any more, and unsubscribed
  });

  it('a network failure during refresh means "no session"', async () => {
    server.use(http.post(api('/auth/refresh'), () => HttpResponse.error()));
    expect(await createSession().refresh()).toBeNull();
  });
});
