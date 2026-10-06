import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  getRequestContext,
  requestContextMiddleware,
  resolveRequestId,
  runWithContext,
  updateRequestContext,
} from '../requestContext.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function app() {
  const a = express();
  a.use(requestContextMiddleware);
  a.get('/ctx', (_req, res) => {
    updateRequestContext({ userId: 'u1', role: 'ADMIN' });
    res.json(getRequestContext());
  });
  return a;
}

describe('resolveRequestId', () => {
  it('keeps a safe incoming id', () => {
    expect(resolveRequestId('abc-123_x.y')).toBe('abc-123_x.y');
  });

  it('replaces missing, unsafe or overlong ids with a UUID', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
    expect(resolveRequestId('bad id\nInjected: header')).toMatch(UUID);
    expect(resolveRequestId('x'.repeat(129))).toMatch(UUID);
  });
});

describe('requestContextMiddleware', () => {
  it('echoes the incoming X-Request-Id and exposes the context to handlers', async () => {
    const res = await request(app())
      .get('/ctx')
      .set('X-Request-Id', 'req-42')
      .set('User-Agent', 'vitest');
    expect(res.headers['x-request-id']).toBe('req-42');
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({
      requestId: 'req-42',
      userAgent: 'vitest',
      userId: 'u1',
      role: 'ADMIN',
    });
    expect(typeof body.ip).toBe('string');
  });

  it('generates an id when none is sent', async () => {
    const res = await request(app()).get('/ctx');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect((res.body as { requestId: string }).requestId).toBe(res.headers['x-request-id']);
  });
});

describe('runWithContext / updateRequestContext', () => {
  it('scopes the context to the callback', async () => {
    expect(getRequestContext()).toBeUndefined();
    await runWithContext({ requestId: 'job-1', queue: 'stats' }, async () => {
      await Promise.resolve();
      expect(getRequestContext()).toEqual({ requestId: 'job-1', queue: 'stats' });
    });
    expect(getRequestContext()).toBeUndefined();
  });

  it('is a no-op outside a context', () => {
    expect(() => updateRequestContext({ userId: 'x' })).not.toThrow();
  });
});
