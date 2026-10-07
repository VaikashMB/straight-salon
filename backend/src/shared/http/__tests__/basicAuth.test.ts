import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createErrorHandler, TooManyRequestsError } from '../../errors/index.js';
import { createManualClock } from '../../time/clock.js';
import { basicAuth, parseBasicAuth } from '../basicAuth.js';

const encode = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

function app(
  verify: (u: string, p: string) => Promise<boolean>,
  clock = createManualClock(new Date(0)),
) {
  const server = express();
  server.use(basicAuth({ realm: 'Queues', verify, rememberMs: 60_000, clock }));
  server.get('/board', (_req, res) => {
    res.send('board');
  });
  server.use(createErrorHandler(captureLogger().logger));
  return server;
}

describe('HTTP Basic auth for ops pages (09 §5)', () => {
  it('parses Basic credentials; passwords may contain colons', () => {
    expect(parseBasicAuth(encode('admin@x.com', 'a:b'))).toEqual({
      username: 'admin@x.com',
      password: 'a:b',
    });
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth('Bearer abc')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from(':pw').toString('base64')}`)).toBeNull();
  });

  it('challenges the browser when credentials are missing or wrong', async () => {
    const verify = vi.fn(() => Promise.resolve(false));
    const server = app(verify);

    const missing = await request(server).get('/board');
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toBe('Basic realm="Queues", charset="UTF-8"');
    expect(missing.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(verify).not.toHaveBeenCalled();

    const wrong = await request(server).get('/board').set('Authorization', encode('a@x.com', 'no'));
    expect(wrong.status).toBe(401);
    expect(verify).toHaveBeenCalledWith('a@x.com', 'no');
  });

  it('lets valid credentials through and remembers them for a minute', async () => {
    const clock = createManualClock(new Date(0));
    const verify = vi.fn(() => Promise.resolve(true));
    const server = app(verify, clock);
    const auth = encode('admin@x.com', 'pw');

    expect((await request(server).get('/board').set('Authorization', auth)).text).toBe('board');
    await request(server).get('/board').set('Authorization', auth).expect(200);
    expect(verify).toHaveBeenCalledTimes(1);

    clock.advance(60_001);
    await request(server).get('/board').set('Authorization', auth).expect(200);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('passes a lockout (429) through to the error handler', async () => {
    const server = app(() => Promise.reject(new TooManyRequestsError('Too many failed logins.')));
    const res = await request(server).get('/board').set('Authorization', encode('a@x.com', 'x'));
    expect(res.status).toBe(429);
  });
});
