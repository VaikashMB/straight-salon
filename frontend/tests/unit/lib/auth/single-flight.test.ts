import { describe, expect, it, vi } from 'vitest';
import { singleFlight } from '@/lib/auth/single-flight';

describe('single-flight (05 §5 refresh)', () => {
  it('callers during a run share it; the next call starts a new run', async () => {
    let resolve: (v: string) => void = () => undefined;
    const task = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const run = singleFlight(task);
    const a = run();
    const b = run();
    expect(task).toHaveBeenCalledTimes(1);
    resolve('token');
    expect(await Promise.all([a, b])).toEqual(['token', 'token']);
    void run();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('a failed run is not cached', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('ok');
    const run = singleFlight(task as () => Promise<string>);
    await expect(run()).rejects.toThrow('down');
    await expect(run()).resolves.toBe('ok');
  });
});
