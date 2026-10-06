import { describe, expect, it } from 'vitest';
import { createManualClock, systemClock } from '../clock.js';

describe('clock', () => {
  it('systemClock returns the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('manual clock only moves when told to', () => {
    const clock = createManualClock('2026-10-12T05:30:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-10-12T05:30:00.000Z');
    clock.advance(15 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-10-12T05:45:00.000Z');
    clock.set(new Date('2026-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns a fresh Date each time (callers cannot mutate the clock)', () => {
    const clock = createManualClock('2026-10-12T05:30:00.000Z');
    clock.now().setFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
