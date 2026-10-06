// Injected wherever time matters, so tests can freeze it (10-testing §3). Business logic never
// calls `new Date()` directly.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

// A clock that only moves when told to; for tests and deterministic jobs.
export interface ManualClock extends Clock {
  set(date: Date | string): void;
  advance(ms: number): void;
}

export function createManualClock(start: Date | string): ManualClock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    set: (date) => {
      current = new Date(date).getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
