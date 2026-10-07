import { describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../test/helpers/logger.js';
import { getRequestContext } from '../../shared/http/requestContext.js';
import { createManualClock } from '../../shared/time/clock.js';
import {
  FAILED_OUTBOX_RETENTION_DAYS,
  REMINDER_SCAN_MS,
  scheduledJobs,
  type JobDeps,
} from '../definitions.js';
import { repeatOptionsFor, runScheduledJob, SCHEDULED_JOBS_QUEUE } from '../scheduler.js';

function deps(overrides: Partial<JobDeps> = {}) {
  const { logger, lines } = captureLogger();
  const bookings = {
    queueReminders: vi.fn(() => Promise.resolve(2)),
    markNoShows: vi.fn(() => Promise.resolve(1)),
  };
  const outbox = {
    summarizeFailedBefore: vi.fn(() => Promise.resolve([{ type: 'booking.created', count: 3 }])),
    deleteFailedBefore: vi.fn(() => Promise.resolve(3)),
  };
  const reports = { reconcileYesterday: vi.fn(() => Promise.resolve('2026-10-12')) };
  const clock = createManualClock('2026-10-12T21:30:00.000Z');
  return {
    bookings,
    outbox,
    reports,
    clock,
    lines,
    jobs: scheduledJobs({ bookings, outbox, reports, clock, logger, ...overrides }),
    logger,
  };
}

const byId = (jobs: ReturnType<typeof scheduledJobs>, id: string) =>
  jobs.find((job) => job.id === id)!;

describe('scheduled jobs (09 §7)', () => {
  it('defines every 09 §7 job with its schedule', () => {
    const { jobs } = deps();
    expect(jobs.map((j) => [j.id, j.schedule])).toEqual([
      ['reminders-24h', { every: 300_000 }],
      ['reminders-2h', { every: 300_000 }],
      ['auto-no-show', { every: 300_000 }],
      ['outbox-cleanup', { pattern: '0 3 * * *' }],
      ['stats-reconcile', { pattern: '0 2 * * *' }],
    ]);
  });

  it('stats-reconcile recomputes yesterday through the reports service', async () => {
    const { jobs, reports } = deps();
    expect(await byId(jobs, 'stats-reconcile').run()).toEqual({ days: 1 });
    expect(reports.reconcileYesterday).toHaveBeenCalledOnce();
  });

  it('reminder jobs scan a window as wide as their interval', async () => {
    const { jobs, bookings } = deps();
    expect(await byId(jobs, 'reminders-24h').run()).toEqual({ queued: 2 });
    expect(bookings.queueReminders).toHaveBeenLastCalledWith('24h', REMINDER_SCAN_MS);
    await byId(jobs, 'reminders-2h').run();
    expect(bookings.queueReminders).toHaveBeenLastCalledWith('2h', REMINDER_SCAN_MS);
  });

  it('FR-042 auto-no-show delegates to the bookings service', async () => {
    const { jobs, bookings } = deps();
    expect(await byId(jobs, 'auto-no-show').run()).toEqual({ marked: 1 });
    expect(bookings.markNoShows).toHaveBeenCalledOnce();
  });

  it('outbox-cleanup logs a summary, then removes FAILED events older than 30 days', async () => {
    const { jobs, outbox, clock, lines } = deps();
    expect(await byId(jobs, 'outbox-cleanup').run()).toEqual({ deleted: 3 });
    const cutoff = new Date(clock.now().getTime() - FAILED_OUTBOX_RETENTION_DAYS * 86_400_000);
    expect(outbox.summarizeFailedBefore).toHaveBeenCalledWith(cutoff);
    expect(outbox.deleteFailedBefore).toHaveBeenCalledWith(cutoff);
    expect(lines().find((l) => l.msg === 'Removing FAILED outbox events')).toMatchObject({
      level: 'warn',
      byType: [{ type: 'booking.created', count: 3 }],
    });
  });

  it('outbox-cleanup does nothing when there is nothing to remove', async () => {
    const { jobs, outbox } = deps({
      outbox: {
        summarizeFailedBefore: () => Promise.resolve([]),
        deleteFailedBefore: vi.fn(() => Promise.resolve(0)),
      },
    });
    expect(await byId(jobs, 'outbox-cleanup').run()).toEqual({ deleted: 0 });
    expect(outbox.deleteFailedBefore).not.toHaveBeenCalled();
  });

  it('cron jobs run in the salon timezone; interval jobs need none', () => {
    const { jobs } = deps();
    expect(repeatOptionsFor(byId(jobs, 'outbox-cleanup'), 'Asia/Kolkata')).toEqual({
      pattern: '0 3 * * *',
      tz: 'Asia/Kolkata',
    });
    expect(repeatOptionsFor(byId(jobs, 'auto-no-show'), 'Asia/Kolkata')).toEqual({
      every: 300_000,
    });
  });

  it('each run has its own context and is logged with its counts (07 §1.1, §1.5)', async () => {
    const { logger, lines } = captureLogger();
    let seen: ReturnType<typeof getRequestContext>;
    const job = {
      id: 'auto-no-show',
      schedule: { every: 1 },
      run: () => {
        seen = getRequestContext();
        return Promise.resolve({ marked: 4 });
      },
    };
    expect(await runScheduledJob(job, logger, 'run-1')).toEqual({ marked: 4 });
    expect(seen).toEqual({
      requestId: 'job-auto-no-show-run-1',
      queue: SCHEDULED_JOBS_QUEUE,
      jobId: 'run-1',
    });
    const done = lines().find((l) => l.msg === 'Scheduled job done');
    expect(done).toMatchObject({ level: 'info', job: 'auto-no-show', marked: 4 });
    expect(typeof done!.durationMs).toBe('number');
  });
});
