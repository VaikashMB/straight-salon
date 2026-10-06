import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../shared/logger/index.js';
import { createReadinessService, type Dependency } from '../health.service.js';

const logger = createLogger({
  level: 'silent',
  pretty: false,
  env: 'test',
  version: 'test',
  processName: 'api',
});

const up = (critical: boolean): Dependency => ({ critical, check: () => Promise.resolve() });
const down = (critical: boolean): Dependency => ({
  critical,
  check: () => Promise.reject(new Error('connection refused')),
});

describe('createReadinessService', () => {
  it('reports ok when every dependency is up', async () => {
    const service = createReadinessService({ mongo: up(true), redis: up(false) }, logger);
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      checks: { mongo: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('reports degraded when only a non-critical dependency (Redis) is down', async () => {
    const service = createReadinessService({ mongo: up(true), redis: down(false) }, logger);
    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      checks: { mongo: { status: 'up' }, redis: { status: 'down' } },
    });
  });

  it('reports error when a critical dependency (Mongo) is down', async () => {
    const service = createReadinessService({ mongo: down(true), redis: down(false) }, logger);
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      checks: { mongo: { status: 'down' }, redis: { status: 'down' } },
    });
  });

  it('treats a check that exceeds the timeout as down', async () => {
    vi.useFakeTimers();
    try {
      const hanging: Dependency = { critical: true, check: () => new Promise(() => undefined) };
      const pending = createReadinessService({ mongo: hanging }, logger, 50).check();
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toEqual({
        status: 'error',
        checks: { mongo: { status: 'down' } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports shutting_down without running checks once shutdown has started', async () => {
    const check = vi.fn(() => Promise.resolve());
    const service = createReadinessService({ mongo: { critical: true, check } }, logger);
    service.markShuttingDown();
    await expect(service.check()).resolves.toEqual({ status: 'shutting_down', checks: {} });
    expect(check).not.toHaveBeenCalled();
  });
});
