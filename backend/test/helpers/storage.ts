import type { ObjectStorage } from '../../src/shared/storage/objectStorage.js';

export interface MemoryStorage extends ObjectStorage {
  objects: Map<string, { body: Buffer; contentType: string }>;
}

// In-memory ObjectStorage for API tests; the local-disk adapter has its own unit test.
export function createMemoryStorage(publicUrl = 'http://localhost:4000/uploads'): MemoryStorage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    put(key, body, contentType) {
      objects.set(key, { body, contentType });
      return Promise.resolve({ key, url: `${publicUrl}/${key}` });
    },
  };
}
