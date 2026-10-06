import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../errors/index.js';
import { createManualClock } from '../../time/clock.js';
import { createAccessTokenService, parseDurationSeconds } from '../accessToken.js';

const config = {
  secret: 'unit-test-secret-at-least-32-characters!',
  ttl: '15m',
  issuer: 'straight-salon-api',
  audience: 'straight-salon-web',
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedError);
    return (err as UnauthorizedError).code;
  }
}

describe('parseDurationSeconds', () => {
  it.each([
    ['900s', 900],
    ['15m', 900],
    ['1h', 3600],
    ['7d', 604_800],
  ])('%s -> %i', (input, seconds) => {
    expect(parseDurationSeconds(input)).toBe(seconds);
  });

  it('rejects other formats', () => {
    expect(() => parseDurationSeconds('15 minutes')).toThrow('Invalid duration');
  });
});

describe('access tokens (06 §1)', () => {
  it('signs the spec claims (no PII) and verifies them', async () => {
    const clock = createManualClock('2026-10-06T09:00:00.000Z');
    const tokens = createAccessTokenService(config, clock);
    const token = await tokens.sign({ userId: 'u1', role: 'STAFF', staffId: 's1' });

    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      sub: 'u1',
      role: 'STAFF',
      staffId: 's1',
      iss: config.issuer,
      aud: config.audience,
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
    expect(payload.jti).toEqual(expect.any(String));
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'role',
      'staffId',
      'sub',
    ]);

    await expect(tokens.verify(token)).resolves.toEqual({
      userId: 'u1',
      role: 'STAFF',
      staffId: 's1',
    });
    expect(tokens.ttlSeconds).toBe(900);
  });

  it('omits staffId when absent', async () => {
    const tokens = createAccessTokenService(config);
    await expect(
      tokens.verify(await tokens.sign({ userId: 'u2', role: 'CUSTOMER' })),
    ).resolves.toEqual({ userId: 'u2', role: 'CUSTOMER' });
  });

  it('expired -> 401 TOKEN_EXPIRED, so the frontend refreshes', async () => {
    const clock = createManualClock('2026-10-06T09:00:00.000Z');
    const tokens = createAccessTokenService(config, clock);
    const token = await tokens.sign({ userId: 'u1', role: 'ADMIN' });
    clock.advance(16 * 60_000);
    expect(await codeOf(tokens.verify(token))).toBe('TOKEN_EXPIRED');
  });

  it('anything else invalid -> 401 UNAUTHENTICATED', async () => {
    const tokens = createAccessTokenService(config);
    const other = createAccessTokenService({
      ...config,
      secret: 'a-completely-different-secret-value!!',
    });
    const wrongAudience = createAccessTokenService({ ...config, audience: 'someone-else' });
    const token = await other.sign({ userId: 'u1', role: 'ADMIN' });
    expect(await codeOf(tokens.verify(token))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(tokens.verify(await wrongAudience.sign({ userId: 'u', role: 'ADMIN' }))),
    ).toBe('UNAUTHENTICATED');
    expect(await codeOf(tokens.verify('not.a.jwt'))).toBe('UNAUTHENTICATED');
  });

  it('rejects a correctly signed token with an unknown role', async () => {
    const tokens = createAccessTokenService(config);
    const forged = await new SignJWT({ role: 'SUPERUSER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.secret));
    expect(await codeOf(tokens.verify(forged))).toBe('UNAUTHENTICATED');
  });
});
