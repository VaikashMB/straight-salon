import { randomUUID } from 'node:crypto';
import { Queue, Worker, type JobsOptions, type RepeatOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_PREFIX } from '../shared/events/bullmqEventBus.js';
import { logConnectionErrors } from '../shared/events/connectionErrors.js';
import { runWithContext } from '../shared/http/requestContext.js';
import type { Logger } from '../shared/logger/index.js';
import type { ScheduledJob } from './definitions.js';

// Runs the scheduled jobs (09 §7) with BullMQ Job Schedulers: each job is upserted under its
// fixed id, so restarts and several worker replicas never duplicate a schedule, and only one
// worker picks up each run. No in-process cron (03 §1).

export const SCHEDULED_JOBS_QUEUE = 'scheduled-jobs';

const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export interface JobScheduler {
  close(): Promise<void>;
}

export interface JobSchedulerDeps {
  redisUrl: string;
  jobs: ScheduledJob[];
  timeZone: string; // salon timezone, for cron patterns
  logger: Logger;
  prefix?: string;
  queueName?: string;
}

export function repeatOptionsFor(job: ScheduledJob, timeZone: string): Omit<RepeatOptions, 'key'> {
  return 'every' in job.schedule
    ? { every: job.schedule.every }
    : { pattern: job.schedule.pattern, tz: timeZone };
}

// Runs one job in its own logging/audit context (07 §1.1) and logs it (07 §1.5).
export async function runScheduledJob(
  job: ScheduledJob,
  logger: Logger,
  runId: string = randomUUID(),
): Promise<Record<string, number>> {
  return runWithContext(
    { requestId: `job-${job.id}-${runId}`, queue: SCHEDULED_JOBS_QUEUE, jobId: runId },
    async () => {
      const started = performance.now();
      logger.debug({ job: job.id }, 'Scheduled job started');
      const result = await job.run();
      logger.info(
        { job: job.id, ...result, durationMs: Math.round(performance.now() - started) },
        'Scheduled job done',
      );
      return result;
    },
  );
}

export async function startJobScheduler(deps: JobSchedulerDeps): Promise<JobScheduler> {
  const { jobs, timeZone, prefix = QUEUE_PREFIX, queueName = SCHEDULED_JOBS_QUEUE } = deps;
  const log = deps.logger.child({ component: 'job-scheduler' });
  // BullMQ requires maxRetriesPerRequest: null on its connections (workers block on Redis).
  const connection = new Redis(deps.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(queueName, { connection, prefix });
  logConnectionErrors(log, 'job-scheduler', [connection, queue]);
  const byId = new Map(jobs.map((job) => [job.id, job]));

  // Drop schedules whose job no longer exists (renamed or removed in a later release).
  for (const existing of await queue.getJobSchedulers()) {
    if (!byId.has(existing.key)) {
      await queue.removeJobScheduler(existing.key);
      log.info({ job: existing.key }, 'Removed obsolete job schedule');
    }
  }
  for (const job of jobs) {
    await queue.upsertJobScheduler(job.id, repeatOptionsFor(job, timeZone), {
      name: job.id,
      opts: JOB_OPTIONS,
    });
  }

  const worker = new Worker(
    queueName,
    async (bullJob) => {
      const job = byId.get(bullJob.name);
      if (!job) {
        log.warn({ job: bullJob.name }, 'No handler for scheduled job; skipped');
        return {};
      }
      return runScheduledJob(job, log, bullJob.id ?? randomUUID());
    },
    // One run at a time per worker: the jobs are short, and a slow run must not overlap itself.
    { connection, prefix, concurrency: 1 },
  );
  logConnectionErrors(log, 'job-scheduler-worker', [worker]);
  worker.on('failed', (bullJob, err) => {
    const final = bullJob ? bullJob.attemptsMade >= (bullJob.opts.attempts ?? 1) : true;
    log[final ? 'error' : 'warn'](
      { err, job: bullJob?.name, attempt: bullJob?.attemptsMade },
      final ? 'Scheduled job failed after final attempt' : 'Scheduled job failed; will retry',
    );
  });

  log.info({ jobs: jobs.map((job) => job.id), timeZone }, 'Job schedules registered');

  return {
    async close() {
      await worker.close();
      await queue.close();
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
