import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStorage } from '../../src/shared/storage/objectStorage.js';
import { loginAs } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { buildApiTestApp } from '../setup/testApp.js';

// API-027 end to end with the local ObjectStorage adapter: upload, then fetch from /uploads.
let dir: string;

beforeAll(async () => {
  await connectTestDb();
  dir = await mkdtemp(join(tmpdir(), 'ss-uploads-int-'));
});
afterAll(async () => {
  await disconnectTestDb();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(clearCollections);

describe('uploaded images are served from /uploads', () => {
  it('upload -> GET the returned URL path, embeddable cross-origin, long-cached', async () => {
    const { app } = buildApiTestApp({
      storage: createLocalStorage({ dir, publicUrl: 'http://localhost:4000/uploads' }),
      config: { uploadsDir: dir },
    });
    const webp = await sharp({
      create: { width: 3, height: 3, channels: 3, background: '#faf7f2' },
    })
      .webp()
      .toBuffer();
    const upload = await request(app)
      .post('/api/v1/uploads/images')
      .set('Authorization', (await loginAs('ADMIN')).header)
      .attach('file', webp, 'swatch.webp');
    expect(upload.status).toBe(201);
    const path = new URL((upload.body as { url: string }).url).pathname;

    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('misses, directory listings and dotfiles are 404 problems', async () => {
    const { app } = buildApiTestApp({ config: { uploadsDir: dir } });
    for (const path of ['/uploads/images/missing.png', '/uploads/', '/uploads/.env']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });
});
