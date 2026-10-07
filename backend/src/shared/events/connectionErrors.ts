import type { Logger } from '../logger/index.js';

// BullMQ queues/workers and their ioredis connections emit 'error' while Redis is unreachable;
// without a listener they print raw stack traces to stderr. This routes them to the logger as
// one warn per component per minute (07 §1, like the cache in 08 §1). They reconnect by
// themselves; events wait safely in the outbox meanwhile (08 §5).

interface ErrorEmitter {
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export function logConnectionErrors(
  logger: Logger,
  component: string,
  emitters: ErrorEmitter[],
  { intervalMs = 60_000, now = () => Date.now() }: { intervalMs?: number; now?: () => number } = {},
): void {
  let lastLoggedAt = Number.NEGATIVE_INFINITY;
  const onError = (err: Error) => {
    const at = now();
    if (at - lastLoggedAt < intervalMs) return;
    lastLoggedAt = at;
    logger.warn({ err, component }, 'Queue connection error; retrying in the background');
  };
  for (const emitter of emitters) emitter.on('error', onError);
}
