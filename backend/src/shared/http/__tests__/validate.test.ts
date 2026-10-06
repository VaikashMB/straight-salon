import express, { json } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from '../../../docs/zod.js';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createErrorHandler } from '../../errors/index.js';
import { validate, validatedPart } from '../validate.js';

const bodySchema = z.object({ name: z.string().min(2), count: z.number().int() }).strict();
const querySchema = z.object({ page: z.coerce.number().int().min(1) });
const paramsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/) });

function app() {
  const a = express();
  a.use(json());
  a.post(
    '/items/:id',
    validate({ body: bodySchema, query: querySchema, params: paramsSchema }),
    (req, res) => {
      res.json({
        body: validatedPart(req, 'body'),
        query: validatedPart(req, 'query'),
        params: validatedPart(req, 'params'),
      });
    },
  );
  a.get('/unvalidated', (req, res) => {
    res.json(validatedPart(req, 'body'));
  });
  a.use(createErrorHandler(captureLogger().logger));
  return a;
}

const id = '6712c0f9a1b2c3d4e5f60789';

describe('validate', () => {
  it('stores parsed (coerced) values on req.validated', async () => {
    const res = await request(app())
      .post(`/items/${id}?page=2`)
      .send({ name: 'Haircut', count: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      body: { name: 'Haircut', count: 3 },
      query: { page: 2 },
      params: { id },
    });
  });

  it('collects errors from every part with prefixed paths', async () => {
    const res = await request(app())
      .post('/items/not-an-id?page=0')
      .send({ name: 'H', count: 'x', extra: true });
    expect(res.status).toBe(400);
    const paths = (JSON.parse(res.text) as { errors: { path: string }[] }).errors
      .map((e) => e.path)
      .sort();
    // "body" = the unknown-key error from .strict(), which has no field path of its own.
    expect(paths).toEqual(['body', 'count', 'name', 'params.id', 'query.page']);
  });

  it('rejects unknown body fields (06 §4 .strict)', async () => {
    const res = await request(app())
      .post(`/items/${id}?page=1`)
      .send({ name: 'Haircut', count: 1, role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('VALIDATION_FAILED');
  });

  it('rejects objects where strings are expected (NoSQL injection, 06 §4)', async () => {
    const res = await request(app())
      .post(`/items/${id}?page=1`)
      .send({ name: { $gt: '' }, count: 1 });
    expect(res.status).toBe(400);
  });

  it('validatedPart throws a clear error for unvalidated parts', async () => {
    const res = await request(app()).get('/unvalidated');
    expect(res.status).toBe(500);
  });
});
