import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { createS3Storage } from '../../src/shared/storage/objectStorage.js';

// The S3 adapter against a real S3-compatible server (16 §3.4). Needs SeaweedFS with the
// credentials below and anonymous read on `uploads`, as the CI test-backend job starts it;
// skipped when S3_TEST_ENDPOINT is unset, so local runs don't need it. Locally:
//   S3_TEST_ENDPOINT=http://127.0.0.1:8333 npm run test -w backend  (after starting SeaweedFS
//   as in .github/workflows/ci.yml).
const endpoint = process.env.S3_TEST_ENDPOINT;
const credentials = {
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'testkey',
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'testsecret',
};

describe.skipIf(!endpoint)('S3 object storage against SeaweedFS (16 §3.4)', () => {
  const bucket = 'uploads';

  beforeAll(async () => {
    const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((err: { name?: string }) => {
      if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') throw err;
    });
  });

  it('stores an object that browsers can then read anonymously at the returned URL', async () => {
    const storage = createS3Storage({
      endpoint,
      region: 'us-east-1',
      bucket,
      ...credentials,
      forcePathStyle: true,
      publicUrl: `${endpoint}/${bucket}`,
    });
    const key = `images/int-${Date.now()}.txt`;
    const stored = await storage.put(key, Buffer.from('hello object storage'), 'text/plain');
    expect(stored.url).toBe(`${endpoint}/${bucket}/${key}`);

    const res = await fetch(stored.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('hello object storage');
  });

  it('rejects writes with the wrong secret', async () => {
    const storage = createS3Storage({
      endpoint,
      region: 'us-east-1',
      bucket,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: 'wrong',
      forcePathStyle: true,
      publicUrl: `${endpoint}/${bucket}`,
    });
    await expect(storage.put('images/x.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow();
  });
});
