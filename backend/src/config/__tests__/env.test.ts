import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../env.js';

describe('parseEnv', () => {
  it('applies defaults when only required variables are set', () => {
    expect(parseEnv({ PORT: '4000' })).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      APP_VERSION: '0.0.0-dev',
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
    });
  });

  it('parses explicit values, coercing numbers and booleans', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      APP_VERSION: '1.2.3',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'true',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PORT: 8080,
      APP_VERSION: '1.2.3',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: true,
    });
  });

  it('rejects a missing PORT (no hard-coded ports) with a clear message', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    try {
      parseEnv({});
    } catch (err) {
      expect((err as EnvValidationError).issues).toEqual([{ path: 'PORT', message: 'Required' }]);
    }
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(EnvValidationError);
  });

  it('reports every invalid variable by path', () => {
    try {
      parseEnv({ PORT: '70000', NODE_ENV: 'staging', LOG_PRETTY: 'maybe' });
      expect.unreachable('parseEnv should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const paths = (err as EnvValidationError).issues.map((i) => i.path).sort();
      expect(paths).toEqual(['LOG_PRETTY', 'NODE_ENV', 'PORT']);
      expect((err as EnvValidationError).message).toContain('PORT');
    }
  });
});
