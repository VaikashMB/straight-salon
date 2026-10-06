import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createErrorHandler } from '../../errors/index.js';
import { getRequestContext, requestContextMiddleware } from '../../http/requestContext.js';
import { createAccessTokenService } from '../accessToken.js';
import { clearSessionCookies, readRefreshCookie, setSessionCookies } from '../cookies.js';
import { authenticate, authorize, requireAuth, requireCsrfHeader } from '../middleware.js';

const tokens = createAccessTokenService({
  secret: 'unit-test-secret-at-least-32-characters!',
  ttl: '15m',
  issuer: 'i',
  audience: 'a',
});

function app() {
  const a = express();
  a.use(requestContextMiddleware);
  a.get('/me', authenticate(tokens), (req, res) => {
    res.json({ auth: req.auth, context: getRequestContext() });
  });
  a.get('/admin', authenticate(tokens), authorize('users:manage'), (_req, res) => {
    res.send('ok');
  });
  a.get(
    '/any-staff',
    authenticate(tokens),
    authorize('booking:read:any', 'booking:status:own'),
    (_req, res) => {
      res.send('ok');
    },
  );
  a.get('/no-auth-then-authorize', authorize('users:read'), (_req, res) => {
    res.send('unreachable');
  });
  a.get('/require-auth', (req, res) => {
    res.json(requireAuth(req));
  });
  a.post('/csrf', requireCsrfHeader, (_req, res) => {
    res.send('ok');
  });
  a.use(createErrorHandler(captureLogger().logger));
  return a;
}

const bearer = async (role: 'CUSTOMER' | 'STAFF' | 'RECEPTIONIST' | 'ADMIN') =>
  `Bearer ${await tokens.sign({ userId: 'u-1', role })}`;

describe('authenticate', () => {
  it('rejects missing or malformed Authorization headers with 401 UNAUTHENTICATED', async () => {
    for (const header of [undefined, 'Basic abc', 'Bearer ', 'Bearer not-a-jwt']) {
      const req = request(app()).get('/me');
      const res = header ? await req.set('Authorization', header) : await req;
      expect(res.status).toBe(401);
      expect(res.text).toContain('UNAUTHENTICATED');
    }
  });

  it('puts the user on req.auth and into the logging/audit context', async () => {
    const res = await request(app())
      .get('/me')
      .set('Authorization', await bearer('STAFF'));
    expect(res.status).toBe(200);
    const body = res.body as { auth: unknown; context: Record<string, unknown> };
    expect(body.auth).toEqual({ userId: 'u-1', role: 'STAFF' });
    expect(body.context).toMatchObject({ userId: 'u-1', role: 'STAFF' });
  });
});

describe('authorize', () => {
  it('allows a role holding the permission and forbids others (403)', async () => {
    expect(
      (
        await request(app())
          .get('/admin')
          .set('Authorization', await bearer('ADMIN'))
      ).status,
    ).toBe(200);
    const denied = await request(app())
      .get('/admin')
      .set('Authorization', await bearer('RECEPTIONIST'));
    expect(denied.status).toBe(403);
    expect(denied.text).toContain('FORBIDDEN');
  });

  it('accepts any one of several permissions', async () => {
    expect(
      (
        await request(app())
          .get('/any-staff')
          .set('Authorization', await bearer('STAFF'))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .get('/any-staff')
          .set('Authorization', await bearer('RECEPTIONIST'))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .get('/any-staff')
          .set('Authorization', await bearer('CUSTOMER'))
      ).status,
    ).toBe(403);
  });

  it('401s when used without authenticate, and requireAuth throws without auth', async () => {
    expect((await request(app()).get('/no-auth-then-authorize')).status).toBe(401);
    expect((await request(app()).get('/require-auth')).status).toBe(401);
  });
});

describe('requireCsrfHeader (06 §4)', () => {
  it('requires X-Requested-With: straight-salon-web', async () => {
    expect((await request(app()).post('/csrf')).status).toBe(403);
    expect(
      (await request(app()).post('/csrf').set('X-Requested-With', 'XMLHttpRequest')).status,
    ).toBe(403);
    expect(
      (await request(app()).post('/csrf').set('X-Requested-With', 'straight-salon-web')).status,
    ).toBe(200);
  });
});

describe('session cookies (06 §1)', () => {
  function cookieApp(domain?: string) {
    const a = express();
    a.get('/set', (_req: Request, res: Response) => {
      setSessionCookies(
        res,
        { secure: true, domain },
        'opaque-token',
        new Date('2026-10-13T09:00:00Z'),
        new Date('2026-10-06T09:00:00Z'),
      );
      res.end();
    });
    a.get('/clear', (_req: Request, res: Response) => {
      clearSessionCookies(res, { secure: false });
      res.end();
    });
    a.get('/read', (req: Request, res: Response) => {
      res.json({ token: readRefreshCookie(req) ?? null });
    });
    return a;
  }

  it('sets ss_rt (httpOnly, /api/v1/auth) and ss_session (/), SameSite=Lax, Secure, 7-day Max-Age', async () => {
    const cookies = (await request(cookieApp()).get('/set')).headers[
      'set-cookie'
    ] as unknown as string[];
    const rt = cookies.find((c) => c.startsWith('ss_rt='))!;
    const session = cookies.find((c) => c.startsWith('ss_session='))!;
    expect(rt).toMatch(/ss_rt=opaque-token;/);
    expect(rt).toContain('Path=/api/v1/auth');
    expect(rt).toContain('Max-Age=604800');
    for (const c of [rt, session]) {
      expect(c).toContain('HttpOnly');
      expect(c).toContain('Secure');
      expect(c).toContain('SameSite=Lax');
      expect(c).not.toContain('Domain=');
    }
    expect(session).toMatch(/ss_session=1;.*Path=\//);
  });

  it('adds Domain only when configured', async () => {
    const cookies = (await request(cookieApp('salon.example')).get('/set')).headers[
      'set-cookie'
    ] as unknown as string[];
    expect(cookies.every((c) => c.includes('Domain=salon.example'))).toBe(true);
  });

  it('clears both cookies', async () => {
    const cookies = (await request(cookieApp()).get('/clear')).headers[
      'set-cookie'
    ] as unknown as string[];
    expect(cookies.some((c) => /^ss_rt=;.*Expires=Thu, 01 Jan 1970/.test(c))).toBe(true);
    expect(cookies.some((c) => /^ss_session=;/.test(c))).toBe(true);
  });

  it('reads the refresh cookie when present', async () => {
    expect(
      (await request(cookieApp()).get('/read').set('Cookie', 'other=1; ss_rt=abc')).body,
    ).toEqual({ token: 'abc' });
    expect((await request(cookieApp()).get('/read').set('Cookie', 'other=1')).body).toEqual({
      token: null,
    });
    expect((await request(cookieApp()).get('/read')).body).toEqual({ token: null });
  });
});
