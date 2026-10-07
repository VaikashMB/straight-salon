import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/index.js';
import { singleFileUpload, uploadedFile } from '../upload.js';

// A tiny app around the middleware; errors are rendered as { status, code }.
function app(maxBytes = 10) {
  const server = express();
  server.post('/upload', singleFileUpload('file', maxBytes), (req, res) => {
    const file = uploadedFile(req, 'file');
    res.json({ size: file.size, name: file.originalname });
  });
  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    const appError = err as AppError;
    res.status(appError.statusCode).json({ code: appError.code, message: appError.message });
  };
  server.use(onError);
  return server;
}

describe('singleFileUpload (API-027)', () => {
  it('accepts one file field and exposes it', async () => {
    const res = await request(app()).post('/upload').attach('file', Buffer.from('12345'), 'a.png');
    expect(res.body).toEqual({ size: 5, name: 'a.png' });
  });

  it('413 INVALID_FILE when the file is too large', async () => {
    const res = await request(app(4)).post('/upload').attach('file', Buffer.from('12345'), 'a.png');
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'INVALID_FILE' });
  });

  it('400 INVALID_FILE for another field name, extra fields, a JSON body or no file', async () => {
    const wrongField = await request(app())
      .post('/upload')
      .attach('photo', Buffer.from('1'), 'a.png');
    const extraField = await request(app())
      .post('/upload')
      .field('note', 'hi')
      .attach('file', Buffer.from('1'), 'a.png');
    const json = await request(app()).post('/upload').send({ file: 'x' });
    const noFile = await request(app())
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .send('--x--\r\n');
    for (const res of [wrongField, extraField, json, noFile]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_FILE' });
    }
  });

  it('400 INVALID_FILE for a malformed multipart body', async () => {
    const res = await request(app(1000))
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .send(
        '--x\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nunterminated',
      );
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_FILE' });
  });
});
