import type { BookingsService } from '../modules/bookings/bookings.service.js';
import type { OutboxRepository } from '../shared/events/outbox.repository.js';
import type { Logger } from '../shared/logger/index.js';
import type { Clock } from '../shared/time/clock.js';

// Scheduled jobs (09 §7). The worker registers them as BullMQ Job Schedulers (scheduler.ts);
// each run calls a service, so the rules live with their module. `stats-reconcile` arrives
// in Phase 7 with daily_stats.

export const REMINDER_SCAN_MS = 5 * 60_000; // the reminder windows are as wide as the interval
export const FAILED_OUTBOX_RETENTION_DAYS = 30;

export type JobSchedule =
  | { every: number } // milliseconds
  | { pattern: string }; // cron, in the salon timezone

export interface ScheduledJob {
  id: string; // fixed scheduler id: upserting it never duplicates a schedule
  schedule: JobSchedule;
  run(): Promise<Record<string, number>>; // counts for the success log line
}

export interface JobDeps {
  bookings: Pick<BookingsService, 'queueReminders' | 'markNoShows'>;
  outbox: Pick<OutboxRepository, 'summarizeFailedBefore' | 'deleteFailedBefore'>;
  clock: Clock;
  logger: Logger;
}

export function scheduledJobs(deps: JobDeps): ScheduledJob[] {
  const { bookings, outbox, clock } = deps;
  return [
    {
      id: 'reminders-24h',
      schedule: { every: REMINDER_SCAN_MS },
      run: async () => ({ queued: await bookings.queueReminders('24h', REMINDER_SCAN_MS) }),
    },
    {
      id: 'reminders-2h',
      schedule: { every: REMINDER_SCAN_MS },
      run: async () => ({ queued: await bookings.queueReminders('2h', REMINDER_SCAN_MS) }),
    },
    {
      id: 'auto-no-show',
      schedule: { every: 5 * 60_000 },
      run: async () => ({ marked: await bookings.markNoShows() }),
    },
    {
      id: 'outbox-cleanup',
      schedule: { pattern: '0 3 * * *' }, // daily 03:00 salon time
      async run() {
        const before = new Date(clock.now().getTime() - FAILED_OUTBOX_RETENTION_DAYS * 86_400_000);
        const summary = await outbox.summarizeFailedBefore(before);
        if (summary.length === 0) return { deleted: 0 };
        // Logged before deleting, so the record of what was dropped survives (09 §7).
        deps.logger.warn(
          { byType: summary, before: before.toISOString() },
          'Removing FAILED outbox events',
        );
        return { deleted: await outbox.deleteFailedBefore(before) };
      },
    },
  ];
}
