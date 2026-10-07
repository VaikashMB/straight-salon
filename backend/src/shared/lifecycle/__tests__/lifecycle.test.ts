import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createProcessLogger, loadEnvOrExit, registerShutdown } from '../index.js';

const validEnv = {
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PORT: '4000',
  MONGO_URI: 'mongodb://localhost:27017/straight_salon',
  REDIS_URL: 'redis://localhost:6379',
  UPLOADS_PUBLIC_URL: 'http://localhost:4000/uploads',
  APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'warn',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('loadEnvOrExit', () => {
  it('returns the parsed environment when it is valid', () => {
    const exit = vi.fn();
    expect(loadEnvOrExit('api', validEnv, exit)).toMatchObject({ PORT: 4000 });
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits with code 1 when the environment is invalid', () => {
    const exit = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(loadEnvOrExit('worker', { NODE_ENV: 'test' }, exit)).toBeUndefined();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      stdout.mockRestore();
    }
  });
});

describe('createProcessLogger', () => {
  it('uses the configured level', () => {
    const env = loadEnvOrExit('api', validEnv, vi.fn());
    expect(env).toBeDefined();
    expect(createProcessLogger(env!, 'api').level).toBe('warn');
  });
});

describe('registerShutdown', () => {
  function setup(steps: Parameters<typeof registerShutdown>[1], timeoutMs = 1_000) {
    const signals = new EventEmitter();
    const exit = vi.fn();
    const { logger, lines } = captureLogger();
    registerShutdown(logger, steps, { signals, exit, timeoutMs });
    return { signals, exit, lines };
  }

  it('runs every step in order on SIGTERM, then exits 0', async () => {
    const order: string[] = [];
    const { signals, exit } = setup([
      { name: 'readiness', run: () => void order.push('readiness') },
      { name: 'http', run: () => Promise.resolve().then(() => void order.push('http')) },
      { name: 'mongo', run: () => void order.push('mongo') },
    ]);

    signals.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(order).toEqual(['readiness', 'http', 'mongo']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps going after a failing step and exits 1', async () => {
    const last = vi.fn();
    const { signals, exit, lines } = setup([
      { name: 'redis', run: () => Promise.reject(new Error('boom')) },
      { name: 'mongo', run: last },
    ]);

    signals.emit('SIGINT', 'SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(last).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines().some((l) => l.msg === 'Shutdown step failed' && l.step === 'redis')).toBe(true);
  });

  it('ignores a second signal while already shutting down', async () => {
    const step = vi.fn();
    const { signals, exit } = setup([{ name: 'http', run: step }]);

    signals.emit('SIGTERM', 'SIGTERM');
    signals.emit('SIGINT', 'SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(step).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('forces exit 1 when a step hangs past the timeout', async () => {
    vi.useFakeTimers();
    const { signals, exit, lines } = setup(
      [{ name: 'http', run: () => new Promise<void>(() => undefined) }],
      500,
    );

    signals.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(500);

    expect(exit).toHaveBeenCalledWith(1);
    expect(lines().some((l) => l.msg === 'Forced shutdown after timeout')).toBe(true);
  });
});

describe('default process hooks', () => {
  it('loadEnvOrExit calls process.exit(1) by default', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      loadEnvOrExit('relay', {});
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      stdout.mockRestore();
    }
  });

  it('registerShutdown listens on the real process and exits via process.exit by default', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const once = vi.spyOn(process, 'once');
    try {
      registerShutdown(captureLogger().logger, []);
      const sigterm = once.mock.calls.find(([signal]) => signal === 'SIGTERM')?.[1] as (
        s: NodeJS.Signals,
      ) => void;
      sigterm('SIGTERM');
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    } finally {
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGINT');
      exit.mockRestore();
      once.mockRestore();
    }
  });
});
