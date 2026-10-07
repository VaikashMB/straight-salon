import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { InvalidFileError, MAX_IMAGE_BYTES, processImage } from '../image.js';
import { createLocalStorage } from '../objectStorage.js';

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
