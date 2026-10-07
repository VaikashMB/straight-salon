import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/index.js';
import { systemClock, type Clock } from '../time/clock.js';

// HTTP Basic authentication for browser-only ops pages (Bull Board, 09 §5): the browser shows
// its own login prompt, so no frontend is needed. `verify` checks the credentials (bcrypt,
// lockout and audit live there). Accepted credentials are remembered for `rememberMs` because
// the browser re-sends them on every request and the board polls; only a hash is kept.

export interface BasicAuthOptions {
  realm: string;
  verify: (username: string, password: string) => Promise<boolean>;
  rememberMs?: number;
  clock?: Clock;
}

export function parseBasicAuth(
  header: string | undefined,
): { username: string; password: string } | null {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

export function basicAuth({
  realm,
  verify,
  rememberMs = 60_000,
  clock = systemClock,
}: BasicAuthOptions): RequestHandler {
  const accepted = new Map<string, number>(); // sha256(header) -> expiry
  const challenge = `Basic realm="${realm}", charset="UTF-8"`;

  return async (req, res, next) => {
    const header = req.get('authorization');
    const now = clock.now().getTime();
    const key = header ? createHash('sha256').update(header).digest('hex') : '';
    if (key && (accepted.get(key) ?? 0) > now) {
      next();
      return;
    }
    accepted.delete(key);

    const credentials = parseBasicAuth(header);
    // Throws 429 while the account is locked out; the error handler answers it.
    if (credentials && (await verify(credentials.username, credentials.password))) {
      for (const [k, expiry] of accepted) if (expiry <= now) accepted.delete(k);
      accepted.set(key, now + rememberMs);
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', challenge);
    throw new UnauthorizedError('Admin email and password required.');
  };
}
