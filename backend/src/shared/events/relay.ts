import type { Logger } from '../logger/index.js';
import { systemClock, type Clock } from '../time/clock.js';
import type { EventBus } from './EventBus.js';
import type { OutboxRepository } from './outbox.repository.js';

// Outbox relay (09 §4): moves PENDING outbox rows onto the EventBus. Delivery is at-least-once,
// so consumers must be idempotent (09 §6). Safe to run several relays: rows are claimed
// atomically, and stale claims from a crashed relay are released after `staleClaimMs`.

export interface RelayOptions {
  intervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  staleClaimMs?: number;
}

export interface RelayDeps extends RelayOptions {
  repository: OutboxRepository;
  bus: EventBus;
  logger: Logger;
  clock?: Clock;
  // Resolves when a new outbox row is inserted (MongoDB change stream); optional speed-up.
  watchInserts?: (onInsert: () => void) => { close(): Promise<void> } | undefined;
}

export interface OutboxRelay {
  start(): void;
  stop(): Promise<void>;
  // One poll: reset stale claims, then claim and publish up to batchSize events.
  runOnce(): Promise<{ published: number; failed: number; claimed: number }>;
  wake(): void;
}

export function createOutboxRelay(deps: RelayDeps): OutboxRelay {
  const {
    repository,
    bus,
    clock = systemClock,
    intervalMs = 500,
    batchSize = 100,
    maxAttempts = 10,
    staleClaimMs = 60_000,
  } = deps;
  const log = deps.logger.child({ component: 'outbox-relay' });

  let running = false;
  let loop: Promise<void> | undefined;
  let wakeUp: (() => void) | undefined;
  let watcher: { close(): Promise<void> } | undefined;

  async function runOnce() {
    const now = clock.now();
    const reset = await repository.resetStaleClaims(new Date(now.getTime() - staleClaimMs));
    if (reset > 0) log.warn({ count: reset }, 'Released stale outbox claims');

    let published = 0;
    let failed = 0;
    let claimed = 0;
    for (const id of await repository.findPendingIds(batchSize)) {
      const row = await repository.claim(id, clock.now());
      if (!row) continue; // another relay took it
      claimed++;
      try {
        await bus.publish(row.event);
        await repository.markPublished(row.id, clock.now());
        published++;
      } catch (err) {
        failed++;
        const giveUp = row.attempts + 1 >= maxAttempts;
        const message = err instanceof Error ? err.message : String(err);
        await repository.markFailedAttempt(row.id, message, giveUp);
        if (giveUp) {
          log.error(
            { err, eventId: row.event.eventId, eventType: row.event.type },
            'Outbox event FAILED after final attempt',
          );
        } else {
          log.warn(
            { err, eventId: row.event.eventId, attempt: row.attempts + 1 },
            'Outbox publish failed; will retry',
          );
        }
      }
    }
    if (published > 0 || failed > 0) log.info({ published, failed }, 'Outbox batch relayed');
    return { published, failed, claimed };
  }

  function pause(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async function run(): Promise<void> {
    while (running) {
      try {
        const { claimed } = await runOnce();
        if (claimed >= batchSize) continue; // more waiting: go again immediately
      } catch (err) {
        log.error({ err }, 'Outbox relay iteration failed');
      }
      if (running) await pause();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      try {
        watcher = deps.watchInserts?.(() => wakeUp?.());
      } catch (err) {
        log.warn({ err }, 'Outbox change stream unavailable; polling only');
      }
      loop = run();
      log.info({ intervalMs, batchSize }, 'Outbox relay started');
    },
    async stop() {
      running = false;
      wakeUp?.();
      await watcher?.close().catch(() => undefined);
      await loop;
      log.info('Outbox relay stopped');
    },
    runOnce,
    wake() {
      wakeUp?.();
    },
  };
}
