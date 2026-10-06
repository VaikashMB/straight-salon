import { createHash } from 'node:crypto';

// Every Redis key is built here (08-caching §1): prefixed `ss:` + schema version. Bumping
// CACHE_VERSION invalidates everything after a breaking change to cached shapes.
export const CACHE_VERSION = 'v1';
const P = `ss:${CACHE_VERSION}`;

// Stable short hash of a value (key order does not matter), for query-shaped keys.
export function hashKey(value: unknown): string {
  return createHash('sha1').update(stableStringify(value)).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const cacheKeys = {
  settingsPublic: () => `${P}:settings:public`,
  settingsFull: () => `${P}:settings:full`,
  categories: () => `${P}:catalog:categories`,
  services: (query: unknown) => `${P}:catalog:services:${hashKey(query)}`,
  service: (id: string) => `${P}:catalog:service:${id}`,
  staffList: (serviceId: string /* or 'all' */) => `${P}:staff:list:${serviceId}`,
  staff: (id: string) => `${P}:staff:${id}`,
  availability: (staffId: string, date: string, spanMin: number) =>
    `${P}:avail:${staffId}:${date}:${spanMin}`,
  availableDays: (staffId: string /* or 'any' */, serviceIds: string[], from: string, to: string) =>
    `${P}:availdays:${staffId}:${hashKey([...serviceIds].sort())}:${from}:${to}`,
  dashboard: (date: string) => `${P}:reports:dashboard:${date}`,
  reportSummary: (from: string, to: string) => `${P}:reports:summary:${from}:${to}`,
  idempotency: (userId: string, key: string) => `${P}:idem:${userId}:${key}`,
  tag: (tag: string) => `${P}:tag:${tag}`,
  // Other Redis uses (08 §5)
  rateLimit: (scope: string, id: string) => `${P}:rl:${scope}:${id}`,
  loginFailures: (emailHash: string) => `${P}:login_fail:${emailHash}`,
  staffDayLock: (staffId: string, date: string) => `${P}:lock:staff:${staffId}:${date}`,
};

export const cacheTags = {
  settings: 'settings',
  catalog: 'catalog',
  staff: 'staff',
  reports: 'reports',
  availability: (staffId: string, date: string) => `avail:${staffId}:${date}`,
  availableDays: (staffId: string) => `availdays:${staffId}`,
};

// Metric/log label: the segment after the version ("catalog", "avail", ...), never the full key.
export function keyPrefix(key: string): string {
  return key.split(':')[2] ?? 'unknown';
}
