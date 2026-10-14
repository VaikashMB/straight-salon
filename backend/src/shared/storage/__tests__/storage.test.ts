import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { InvalidFileError, MAX_IMAGE_BYTES, processImage } from '../image.js';
import type { PutObjectCommand } from '@aws-sdk/client-s3';
import { createLocalStorage, createObjectStorage, createS3Storage } from '../objectStorage.js';

const image = (format: 'png' | 'jpeg' | 'webp' | 'gif') =>
  sharp({ create: { width: 8, height: 6, channels: 3, background: '#b08d57' } })
    .toFormat(format)
    .toBuffer();

describe('processImage (06 §4 upload rules)', () => {
  it.each([
    ['png', 'png', 'image/png'],
    ['jpeg', 'jpg', 'image/jpeg'],
    ['webp', 'webp', 'image/webp'],
  ] as const)('accepts %s, detected from the bytes', async (format, ext, contentType) => {
    const result = await processImage(await image(format));
    expect(result).toMatchObject({ ext, contentType });
    expect((await sharp(result.buffer).metadata()).format).toBe(format);
  });

  it('re-encodes without metadata (EXIF/GPS dropped) and applies the orientation', async () => {
    const withExif = await sharp(await image('jpeg'))
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Someone' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const result = await processImage(withExif);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([6, 8]); // rotated 90°
  });

  it('rejects other image types, non-images and oversized input', async () => {
    await expect(processImage(await image('gif'))).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_FILE',
    });
    await expect(
      processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toBeInstanceOf(InvalidFileError);
    await expect(processImage(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it('rejects a truncated image that cannot be decoded', async () => {
    const png = await image('png');
    await expect(processImage(png.subarray(0, 40))).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});

describe('local ObjectStorage adapter', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes under its directory and returns the public URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ss-uploads-'));
    dirs.push(dir);
    const storage = createLocalStorage({ dir, publicUrl: 'http://localhost:4000/uploads/' });
    const stored = await storage.put('images/a.png', Buffer.from('png-bytes'), 'image/png');
    expect(stored).toEqual({
      key: 'images/a.png',
      url: 'http://localhost:4000/uploads/images/a.png',
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp dir
    expect((await readFile(join(dir, 'images/a.png'))).toString()).toBe('png-bytes');
  });

  it('refuses keys that escape the directory', async () => {
    const storage = createLocalStorage({ dir: join(tmpdir(), 'ss-unused'), publicUrl: 'http://x' });
    await expect(storage.put('../escape.png', Buffer.from('x'), 'image/png')).rejects.toThrow(
      /Invalid storage key/,
    );
  });
});

// A stand-in for S3Client that records what would have been sent.
function fakeS3() {
  const sent: PutObjectCommand[] = [];
  return {
    sent,
    client: { send: (command: PutObjectCommand) => Promise.resolve(sent.push(command)) },
  };
}

const s3Config = {
  endpoint: 'http://seaweedfs-s3:8333',
  region: 'us-east-1',
  bucket: 'uploads',
  accessKeyId: 'id',
  secretAccessKey: 'secret',
  forcePathStyle: true,
  publicUrl: 'https://salon.localhost/uploads/',
};

describe('S3 object storage (16 §3.4)', () => {
  it('puts the object with its type and long-lived caching, and returns the public URL', async () => {
    const { sent, client } = fakeS3();
    const stored = await createS3Storage(s3Config, client).put(
      'images/abc.webp',
      Buffer.from('img'),
      'image/webp',
    );
    expect(stored).toEqual({
      key: 'images/abc.webp',
      url: 'https://salon.localhost/uploads/images/abc.webp',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input).toMatchObject({
      Bucket: 'uploads',
      Key: 'images/abc.webp',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('refuses keys that look like paths out of the bucket', async () => {
    const { sent, client } = fakeS3();
    const storage = createS3Storage(s3Config, client);
    for (const key of ['', '/abs.png', '../up.png', 'images//x.png', 'images/../x.png']) {
      await expect(storage.put(key, Buffer.from('x'), 'image/png')).rejects.toThrow(
        /Invalid storage key/,
      );
    }
    expect(sent).toHaveLength(0);
  });

  it('builds a real S3 client from the configuration when none is given', () => {
    expect(createS3Storage(s3Config)).toHaveProperty('put');
  });

  it('picks the adapter from STORAGE_DRIVER', async () => {
    const env = {
      UPLOADS_DIR: 'unused',
      UPLOADS_PUBLIC_URL: 'https://salon.localhost/uploads',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
    };
    const { sent, client } = fakeS3();
    const s3 = createObjectStorage(
      {
        ...env,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'uploads',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      },
      client,
    );
    await s3.put('images/a.png', Buffer.from('x'), 'image/png');
    expect(sent[0]!.input.Bucket).toBe('uploads');

    const dir = await mkdtemp(join(tmpdir(), 'ss-storage-'));
    try {
      const local = createObjectStorage({ ...env, STORAGE_DRIVER: 'local', UPLOADS_DIR: dir });
      await local.put('images/b.png', Buffer.from('y'), 'image/png');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test temp dir
      expect(await readFile(join(dir, 'images/b.png'), 'utf8')).toBe('y');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
