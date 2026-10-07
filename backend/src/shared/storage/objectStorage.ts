import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Object storage port (01 §6: no local file storage in business code). v1 ships a local-disk
// adapter whose files the API serves at /uploads (app.ts); an S3-compatible adapter can replace
// it later without touching modules, returning bucket/CDN URLs instead.

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
  const base = publicUrl.replace(/\/+$/, '');
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
