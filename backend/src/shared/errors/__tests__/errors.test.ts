import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { requestContextMiddleware } from '../../http/requestContext.js';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  createErrorHandler,
  ForbiddenError,
  NotFoundError,
  notFoundHandler,
  PayloadTooLargeError,
  problemType,
  ServiceUnavailableError,
  TooManyRequestsError,
  toAppError,
  UnauthorizedError,
  ValidationError,
} from '../index.js';

describe('AppError subclasses (03 §4)', () => {
  it.each([
    [new ValidationError(), 400, 'VALIDATION_FAILED'],
    [new UnauthorizedError(), 401, 'UNAUTHENTICATED'],
    [new UnauthorizedError('Token expired', 'TOKEN_EXPIRED'), 401, 'TOKEN_EXPIRED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError('Taken', 'SLOT_UNAVAILABLE'), 409, 'SLOT_UNAVAILABLE'],
    [new ConflictError('Exists'), 409, 'DUPLICATE'],
    [new PayloadTooLargeError(), 413, 'PAYLOAD_TOO_LARGE'],
    [new BusinessRuleError('CUTOFF_PASSED', 'Too late'), 422, 'CUTOFF_PASSED'],
    [new TooManyRequestsError(), 429, 'RATE_LIMITED'],
    [new ServiceUnavailableError(), 503, 'TEMPORARILY_UNAVAILABLE'],
  ])('%s -> %i %s', (error, status, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
  });

  it('builds the problem type URI from the code', () => {
    expect(problemType('SLOT_UNAVAILABLE')).toBe(
      'https://straightsalon.dev/errors/slot-unavailable',
    );
  });
});

describe('toAppError', () => {
  it('maps Mongo duplicate keys to 409 DUPLICATE', () => {
    expect(toAppError({ code: 11000 })).toMatchObject({ statusCode: 409, code: 'DUPLICATE' });
  });

  it('maps Mongoose VersionError to 409 STALE_VERSION', () => {
    // Built from the prototype: the real constructor needs a model document; only instanceof matters.
    const err: unknown = Object.create(mongoose.Error.VersionError.prototype);
    expect(toAppError(err)).toMatchObject({ statusCode: 409, code: 'STALE_VERSION' });
  });

  it('maps body-parser failures', () => {
    expect(toAppError({ type: 'entity.parse.failed' })).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(toAppError({ type: 'entity.too.large' })).toMatchObject({ statusCode: 413 });
  });

  it('returns undefined for unknown errors', () => {
    expect(toAppError(new Error('boom'))).toBeUndefined();
    expect(toAppError('string error')).toBeUndefined();
  });
});

describe('createErrorHandler', () => {
  function app(error: unknown) {
    const { logger, lines } = captureLogger();
    const a = express();
    a.use(requestContextMiddleware);
    a.get('/fail', () => {
      throw error;
    });
    a.get('/sent', (_req, res, next) => {
      res.status(200).json({ ok: true });
      next(new Error('after headers'));
    });
    a.use(notFoundHandler);
    a.use(createErrorHandler(logger));
    return { app: a, lines };
  }

  it('renders an AppError as RFC 7807 problem JSON', async () => {
    const err = new ValidationError('The request is invalid.', [
      { path: 'startAt', message: 'Required' },
    ]);
    const res = await request(app(err).app).get('/fail').set('X-Request-Id', 'req-1');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(res.text)).toEqual({
      type: 'https://straightsalon.dev/errors/validation-failed',
      title: 'Bad request',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'The request is invalid.',
      instance: '/fail',
      requestId: 'req-1',
      errors: [{ path: 'startAt', message: 'Required' }],
    });
  });

  it('hides unknown errors behind a generic 500 and logs the stack', async () => {
    const { app: a, lines } = app(new Error('Mongo driver said: secret connection string'));
    const res = await request(a).get('/fail');
    expect(res.status).toBe(500);
    const body = JSON.parse(res.text) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', title: 'Internal server error' });
    expect(res.text).not.toContain('secret connection string');
    const logged = lines().find((l) => l.msg === 'Unhandled error');
    expect(logged?.level).toBe('error');
    expect(JSON.stringify(logged)).toContain('secret connection string');
  });

  it('turns unmatched routes into 404 problems', async () => {
    const res = await request(app(null).app).get('/nope');
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toMatchObject({ code: 'NOT_FOUND', instance: '/nope' });
  });

  it('defers to Express when headers were already sent', async () => {
    const res = await request(app(null).app).get('/sent');
    expect(res.status).toBe(200);
  });

  it('falls back to a generic title for unusual statuses', async () => {
    const res = await request(app(new AppError(418, 'TEAPOT', 'Short and stout')).app).get('/fail');
    expect(JSON.parse(res.text)).toMatchObject({ status: 418, title: 'Error', code: 'TEAPOT' });
  });
});
