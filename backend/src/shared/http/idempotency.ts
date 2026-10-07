import { createHash } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import { cacheKeys } from '../cache/keys.js';
import { AppError, BusinessRuleError, ConflictError } from '../errors/index.js';
import type { Logger } from '../logger/index.js';

// Idempotency-Key support (03 §9) for POST /bookings and POST /bookings/{id}/payment.
// The first successful (2xx) response is stored for 24 h under ss:v1:idem:{userId}:{key};
// a repeat with the same body replays it with `Idempotent-Replayed: true`, a repeat with a
// different body is 422 IDEMPOTENCY_KEY_REUSED. While the first request is still running, a
// repeat gets 409 (so a double-clicked "Confirm" cannot book two stylists via "any"). Error
// responses are not stored, so the client may retry with the same key.
// If Redis is unreachable the request runs without idempotency (warned at most once a minute);
// booking creation itself fails closed on the lock (08 §5).

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const TTL_SECONDS = 24 * 60 * 60;
const PENDING_TTL_SECONDS = 60;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const WARN_INTERVAL_MS = 60_000;

interface Stored {
  state: 'pending' | 'done';
  bodyHash: string;
  status?: number;
  body?: unknown;
}

const hashBody = (body: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');

export function idempotency(deps: {
  redis: Pick<Redis, 'set' | 'get' | 'del'>;
  logger: Logger;
}): RequestHandler {
  const { redis, logger } = deps;
  let lastWarnAt = Number.NEGATIVE_INFINITY;
  const warn = (err: unknown) => {
    if (Date.now() - lastWarnAt < WARN_INTERVAL_MS) return;
    lastWarnAt = Date.now();
    logger.warn({ err }, 'Idempotency store unavailable; continuing without it');
  };

  return async (req, res, next) => {
    const key = req.get(IDEMPOTENCY_HEADER);
    if (key === undefined) {
      next();
      return;
    }
    if (!KEY_PATTERN.test(key) || !req.auth) {
      next(
        new AppError(400, 'VALIDATION_FAILED', 'Invalid Idempotency-Key.', [
          {
            path: 'headers.idempotency-key',
            message: 'Use 8-100 letters, digits, "-" or "_" (e.g. a UUID)',
          },
        ]),
      );
      return;
    }
    const redisKey = cacheKeys.idempotency(req.auth.userId, key);
    const bodyHash = hashBody(req.body);

    let reserved: string | null;
    try {
      const pending: Stored = { state: 'pending', bodyHash };
      reserved = await redis.set(
        redisKey,
        JSON.stringify(pending),
        'EX',
        PENDING_TTL_SECONDS,
        'NX',
      );
    } catch (err) {
      warn(err);
      next();
      return;
    }

    if (reserved !== 'OK') {
      let stored: Stored | null = null;
      try {
        const raw = await redis.get(redisKey);
        stored = raw ? (JSON.parse(raw) as Stored) : null;
      } catch (err) {
        warn(err);
      }
      if (stored && stored.bodyHash !== bodyHash) {
        next(
          new BusinessRuleError(
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used with a different request body.',
          ),
        );
        return;
      }
      if (stored?.state === 'done') {
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(stored.status ?? 200).json(stored.body);
        return;
      }
      next(
        new ConflictError(
          'A request with this Idempotency-Key is still being processed.',
          'IDEMPOTENCY_KEY_REUSED',
        ),
      );
      return;
    }

    // Capture the JSON body, then store it (2xx) or release the key (anything else).
    const json = res.json.bind(res) as Response['json'];
    res.json = (body: unknown) => {
      res.locals.idempotentBody = body;
      return json(body);
    };
    res.on('finish', () => {
      const done = res.statusCode >= 200 && res.statusCode < 300;
      const write = done
        ? redis.set(
            redisKey,
            JSON.stringify({
              state: 'done',
              bodyHash,
              status: res.statusCode,
              body: res.locals.idempotentBody as unknown,
            } satisfies Stored),
            'EX',
            TTL_SECONDS,
          )
        : redis.del(redisKey);
      write.catch(warn);
    });
    next();
  };
}
