import { describe, expect, it } from 'vitest';
import { parseQueueArg, RETRYABLE_QUEUES, UnknownQueueError } from '../retryFailed.js';

describe('queues:retry-failed arguments (09 §5)', () => {
  it('accepts every consumer queue and the scheduled-jobs queue', () => {
    expect(RETRYABLE_QUEUES).toEqual([
      'notifications',
      'staff-notifications',
      'cache-invalidation',
      'ratings',
      'stats',
      'scheduled-jobs',
    ]);
    expect(parseQueueArg(['--queue=notifications'])).toBe('notifications');
    expect(parseQueueArg(['--verbose', '--queue= scheduled-jobs '])).toBe('scheduled-jobs');
  });

  it('rejects a missing or unknown queue, listing the valid names', () => {
    expect(() => parseQueueArg([])).toThrow(UnknownQueueError);
    expect(() => parseQueueArg(['--queue=emails'])).toThrow(/one of: notifications, /);
  });
});
