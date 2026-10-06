import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../env.js';

const required = {
  PORT: '4000',
  MONGO_URI: 'mongodb://localhost:27017/straight_salon?replicaSet=rs0',
  REDIS_URL: 'redis://localhost:6379',
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
    });
  });

  it('parses explicit values, coercing numbers and booleans', () => {
    const env = parseEnv({
      ...required,
      NODE_ENV: 'production',
      PORT: '8080',
      APP_VERSION: '1.2.3',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'true',
      MONGO_URI: 'mongodb+srv://user:pass@cluster.example.net/straight_salon',
      REDIS_URL: 'rediss://cache.example.net:6380',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      APP_VERSION: '1.2.3',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: true,
      MONGO_URI: 'mongodb+srv://user:pass@cluster.example.net/straight_salon',
      REDIS_URL: 'rediss://cache.example.net:6380',
    });
  });

  it('reports every missing required variable as "Required"', () => {
    expect(issuesOf({})).toEqual([
      { path: 'MONGO_URI', message: 'Required' },
      { path: 'REDIS_URL', message: 'Required' },
      { path: 'PORT', message: 'Required' },
    ]);
  });

  it('rejects a non-numeric PORT', () => {
    expect(issuesOf({ ...required, PORT: 'abc' }).map((i) => i.path)).toEqual(['PORT']);
  });

  it('rejects URLs with the wrong scheme', () => {
    const paths = issuesOf({
      ...required,
      MONGO_URI: 'postgres://localhost/db',
      REDIS_URL: 'http://localhost:6379',
    }).map((i) => i.path);
    expect(paths).toEqual(['MONGO_URI', 'REDIS_URL']);
  });

  it('reports every invalid variable by path in the error message', () => {
    const source = { ...required, PORT: '70000', NODE_ENV: 'staging', LOG_PRETTY: 'maybe' };
    expect(
      issuesOf(source)
        .map((i) => i.path)
        .sort(),
    ).toEqual(['LOG_PRETTY', 'NODE_ENV', 'PORT']);
    expect(() => parseEnv(source)).toThrow(/PORT/);
  });
});
