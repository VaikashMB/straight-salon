import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../env.js';

const key = randomBytes(32).toString('base64');

const required = {
  PORT: '4000',
  MONGO_URI: 'mongodb://localhost:27017/straight_salon?replicaSet=rs0',
  REDIS_URL: 'redis://localhost:6379',
  OUTBOX_ENCRYPTION_KEY: key,
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

function issuesOf(source: NodeJS.ProcessEnv): { path: string; message: string }[] {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.issues;
    throw err;
  }
  throw new Error('parseEnv should have thrown');
}

describe('parseEnv', () => {
  it('applies defaults when only required variables are set', () => {
    expect(parseEnv(required)).toEqual({
      ...required,
      PORT: 4000,
      NODE_ENV: 'development',
      APP_VERSION: '0.0.0-dev',
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      CORS_ORIGINS: [],
      CACHE_ENABLED: true,
      METRICS_ENABLED: true,
      RUN_RELAY_IN_WORKER: true,
      SWAGGER_ENABLED: true,
      JWT_ACCESS_TTL: '15m',
      JWT_ISSUER: 'straight-salon-api',
      JWT_AUDIENCE: 'straight-salon-web',
      REFRESH_TOKEN_TTL_DAYS: 7,
      COOKIE_DOMAIN: undefined,
      COOKIE_SECURE: false,
      BCRYPT_COST: 12,
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX: 300,
      MIGRATE_ON_START: true,
    });
  });

  it('parses explicit values, coercing numbers, booleans and lists', () => {
    const env = parseEnv({
      ...required,
      NODE_ENV: 'production',
      PORT: '8080',
      APP_VERSION: '1.2.3',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'true',
      MONGO_URI: 'mongodb+srv://user:pass@cluster.example.net/straight_salon',
      REDIS_URL: 'rediss://cache.example.net:6380',
      CORS_ORIGINS: 'http://localhost:3000, https://salon.example.com',
      CACHE_ENABLED: 'false',
      METRICS_ENABLED: 'false',
      RUN_RELAY_IN_WORKER: 'false',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_PRETTY: true,
      CORS_ORIGINS: ['http://localhost:3000', 'https://salon.example.com'],
      CACHE_ENABLED: false,
      METRICS_ENABLED: false,
      RUN_RELAY_IN_WORKER: false,
    });
  });

  it('disables Swagger by default in production, unless explicitly enabled (06 §4)', () => {
    expect(parseEnv({ ...required, NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
    expect(
      parseEnv({ ...required, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
    expect(parseEnv({ ...required, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('reports every missing required variable as "Required"', () => {
    expect(issuesOf({})).toEqual([
      { path: 'MONGO_URI', message: 'Required' },
      { path: 'REDIS_URL', message: 'Required' },
      { path: 'PORT', message: 'Required' },
      {
        path: 'OUTBOX_ENCRYPTION_KEY',
        message: 'Required (run `npm run env:init` to create .env with one)',
      },
      {
        path: 'JWT_ACCESS_SECRET',
        message: 'Required (run `npm run env:init` to create .env with one)',
      },
    ]);
  });

  it('rejects an encryption key that is not 32 bytes of base64', () => {
    const [issue] = issuesOf({
      ...required,
      OUTBOX_ENCRYPTION_KEY: 'replace-with-32-byte-base64-key',
    });
    expect(issue?.path).toBe('OUTBOX_ENCRYPTION_KEY');
    expect(issue?.message).toContain('env:init');
  });

  it('rejects malformed values', () => {
    const paths = issuesOf({
      ...required,
      PORT: 'abc',
      MONGO_URI: 'postgres://localhost/db',
      REDIS_URL: 'http://localhost:6379',
      CORS_ORIGINS: 'not a url',
    }).map((i) => i.path);
    expect(paths.sort()).toEqual(['CORS_ORIGINS.0', 'MONGO_URI', 'PORT', 'REDIS_URL']);
  });

  it('names every invalid variable in the error message', () => {
    const source = { ...required, PORT: '70000', NODE_ENV: 'staging', LOG_PRETTY: 'maybe' };
    expect(
      issuesOf(source)
        .map((i) => i.path)
        .sort(),
    ).toEqual(['LOG_PRETTY', 'NODE_ENV', 'PORT']);
    expect(() => parseEnv(source)).toThrow(/PORT/);
  });

  it('auth settings: production defaults, placeholders, durations and the bcrypt floor (06, NFR-009)', () => {
    const prod = parseEnv({ ...required, NODE_ENV: 'production' });
    expect(prod).toMatchObject({
      COOKIE_SECURE: true,
      MIGRATE_ON_START: false,
      SWAGGER_ENABLED: false,
    });
    expect(parseEnv({ ...required, COOKIE_DOMAIN: ' salon.example ' }).COOKIE_DOMAIN).toBe(
      'salon.example',
    );
    expect(parseEnv({ ...required, COOKIE_DOMAIN: '' }).COOKIE_DOMAIN).toBeUndefined();
    expect(parseEnv({ ...required, NODE_ENV: 'test', BCRYPT_COST: '4' }).BCRYPT_COST).toBe(4);
    expect(issuesOf({ ...required, BCRYPT_COST: '4' }).map((i) => i.path)).toEqual(['BCRYPT_COST']);
    expect(issuesOf({ ...required, JWT_ACCESS_SECRET: 'too-short' }).map((i) => i.path)).toEqual([
      'JWT_ACCESS_SECRET',
    ]);
    expect(
      issuesOf({ ...required, JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters' })[0]
        ?.message,
    ).toContain('env:init');
    expect(issuesOf({ ...required, JWT_ACCESS_TTL: '15 minutes' }).map((i) => i.path)).toEqual([
      'JWT_ACCESS_TTL',
    ]);
  });
});
