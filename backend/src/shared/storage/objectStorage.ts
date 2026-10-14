import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { trimEndChar } from '../text/strings.js';

// Object storage port (01 §6: no local file storage in business code). Two adapters, picked by
// STORAGE_DRIVER (createObjectStorage below): local disk, whose files the API serves at /uploads
// (app.ts; Docker Compose), and S3-compatible object storage (16-stateful-services §3.4; the
// Kubernetes cluster's SeaweedFS), where browsers read public objects straight from the bucket.

export interface StoredObject {
  key: string;
  url: string; // absolute public URL, saved as services.imageUrl / staff.photoUrl
}

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
}

export interface LocalStorageConfig {
  dir: string; // UPLOADS_DIR
  publicUrl: string; // UPLOADS_PUBLIC_URL, where `dir` is served
}

export function createLocalStorage({ dir, publicUrl }: LocalStorageConfig): ObjectStorage {
  const root = resolve(dir);
  const base = trimEndChar(publicUrl, '/');
  return {
    async put(key, body) {
      const path = resolve(join(root, key));
      // Keys are generated server-side; this is defence in depth against traversal.
      if (!path.startsWith(root + sep)) throw new Error(`Invalid storage key "${key}"`);
      /* eslint-disable security/detect-non-literal-fs-filename -- confined to `root` above */
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      /* eslint-enable security/detect-non-literal-fs-filename */
      return { key, url: `${base}/${key}` };
    },
  };
}

// Keys are generated server-side (images/<id>.<ext>); refuse anything that could escape the
// bucket prefix or look like a path, as defence in depth.
function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Invalid storage key "${key}"`);
  }
}

export interface S3StorageConfig {
  endpoint?: string; // S3_ENDPOINT; unset = AWS S3 itself
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean; // bucket in the path (/bucket/key), as SeaweedFS and MinIO expect
  publicUrl: string; // UPLOADS_PUBLIC_URL: where objects of `bucket` are publicly readable
}

// The one SDK call the adapter makes, so tests can pass a fake client.
export interface S3Sender {
  send(command: PutObjectCommand): Promise<unknown>;
}

export function createS3Storage(config: S3StorageConfig, client?: S3Sender): ObjectStorage {
  const s3 =
    client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  const base = trimEndChar(config.publicUrl, '/');
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are unique per upload and never rewritten, so browsers may cache for a year.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return { key, url: `${base}/${key}` };
    },
  };
}

export interface StorageEnv {
  STORAGE_DRIVER: 'local' | 's3';
  UPLOADS_DIR: string;
  UPLOADS_PUBLIC_URL: string;
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE: boolean;
}

// The adapter for this process's configuration. env.ts guarantees the S3_* values are present
// when STORAGE_DRIVER=s3.
export function createObjectStorage(env: StorageEnv, s3Client?: S3Sender): ObjectStorage {
  if (env.STORAGE_DRIVER === 's3') {
    return createS3Storage(
      {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET ?? '',
        accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        publicUrl: env.UPLOADS_PUBLIC_URL,
      },
      s3Client,
    );
  }
  return createLocalStorage({ dir: env.UPLOADS_DIR, publicUrl: env.UPLOADS_PUBLIC_URL });
}
