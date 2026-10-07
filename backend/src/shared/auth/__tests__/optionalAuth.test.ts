import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '../../errors/index.js';
import { createAccessTokenService } from '../accessToken.js';
import { assertPermission, canDo, optionalAuthenticate } from '../middleware.js';

const tokens = createAccessTokenService({
  secret: 'test-secret-that-is-at-least-32-characters-long',
  ttl: '15m',
  issuer: 'straight-salon-api',
  audience: 'straight-salon-web',
});

const reqWith = (authorization?: string) =>
  ({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
  }) as unknown as Request;

describe('optionalAuthenticate', () => {
  it('passes anonymous requests through without req.auth', async () => {
    const req = reqWith();
    const next = vi.fn();
    await optionalAuthenticate(tokens)(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toBeUndefined();
  });

  it('sets req.auth for a valid token (staffId claim included)', async () => {
    const token = await tokens.sign({ userId: 'u1', role: 'STAFF', staffId: 's1' });
    const req = reqWith(`Bearer ${token}`);
    const next = vi.fn();
    await optionalAuthenticate(tokens)(req, {} as Response, next);
    expect(req.auth).toEqual({ userId: 'u1', role: 'STAFF', staffId: 's1' });
  });

  it('rejects a header that is present but invalid', async () => {
    const next = vi.fn();
    await expect(
      optionalAuthenticate(tokens)(reqWith('Bearer nope'), {} as Response, next),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await optionalAuthenticate(tokens)(reqWith('Basic abc'), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});

describe('assertPermission / canDo (admin switches on public endpoints)', () => {
  it('401 when anonymous, 403 for a role without the permission, ok otherwise', () => {
    expect(() => assertPermission(undefined, 'catalog:manage')).toThrow(UnauthorizedError);
    expect(() => assertPermission({ userId: 'u', role: 'STAFF' }, 'catalog:manage')).toThrow(
      ForbiddenError,
    );
    expect(() => assertPermission({ userId: 'u', role: 'ADMIN' }, 'catalog:manage')).not.toThrow();
    expect(canDo(undefined, 'staff:manage')).toBe(false);
    expect(canDo({ userId: 'u', role: 'RECEPTIONIST' }, 'staff:manage')).toBe(false);
    expect(canDo({ userId: 'u', role: 'ADMIN' }, 'staff:manage')).toBe(true);
  });
});
