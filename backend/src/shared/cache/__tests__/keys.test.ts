import { describe, expect, it } from 'vitest';
import { cacheKeys, cacheTags, hashKey, keyPrefix } from '../keys.js';

describe('cache keys (08 §1–2)', () => {
  it('prefixes every key with ss:v1', () => {
    const keys = [
      cacheKeys.settingsPublic(),
      cacheKeys.settingsFull(),
      cacheKeys.categories(),
      cacheKeys.services({ q: 'cut' }),
      cacheKeys.service('s1'),
      cacheKeys.staffList('all'),
      cacheKeys.staff('st1'),
      cacheKeys.availability('st1', '2026-10-12', 60),
      cacheKeys.availableDays('any', ['b', 'a'], '2026-10-01', '2026-10-31'),
      cacheKeys.dashboard('2026-10-12'),
      cacheKeys.reportSummary('2026-10-01', '2026-10-31'),
      cacheKeys.idempotency('u1', 'k1'),
      cacheKeys.tag('catalog'),
      cacheKeys.rateLimit('login', '1.2.3.4'),
      cacheKeys.loginFailures('abc'),
      cacheKeys.staffDayLock('st1', '2026-10-12'),
    ];
    for (const key of keys) expect(key.startsWith('ss:v1:')).toBe(true);
    expect(cacheKeys.availability('st1', '2026-10-12', 60)).toBe('ss:v1:avail:st1:2026-10-12:60');
    expect(cacheKeys.staffDayLock('st1', '2026-10-12')).toBe('ss:v1:lock:staff:st1:2026-10-12');
  });

  it('hashes query-shaped keys independent of property and service order', () => {
    expect(hashKey({ a: 1, b: [1, 2] })).toBe(hashKey({ b: [1, 2], a: 1 }));
    expect(hashKey({ a: 1, skip: undefined })).toBe(hashKey({ a: 1 }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
    expect(hashKey(null)).toHaveLength(16);
    expect(cacheKeys.availableDays('any', ['b', 'a'], 'f', 't')).toBe(
      cacheKeys.availableDays('any', ['a', 'b'], 'f', 't'),
    );
  });

  it('builds tags', () => {
    expect(cacheTags.availability('st1', '2026-10-12')).toBe('avail:st1:2026-10-12');
    expect(cacheTags.availableDays('st1')).toBe('availdays:st1');
  });

  it('derives a low-cardinality prefix label', () => {
    expect(keyPrefix(cacheKeys.service('s1'))).toBe('catalog');
    expect(keyPrefix(cacheKeys.availability('st1', '2026-10-12', 60))).toBe('avail');
    expect(keyPrefix('weird')).toBe('unknown');
  });
});
