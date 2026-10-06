import type { Logger } from '../../shared/logger/index.js';

// Readiness rules (03-backend §6, 08-caching §1): a critical dependency (Mongo) being down
// makes the API not ready (503). A non-critical one (Redis) only degrades it (still 200),
// because reads fall back to Mongo and Redis-backed features degrade per 08 §5.
export interface Dependency {
  check: () => Promise<void>;
  critical: boolean;
}

export type DependencyStatus = 'up' | 'down';
export type ReadinessStatus = 'ok' | 'degraded' | 'error' | 'shutting_down';

export interface ReadinessReport {
  status: ReadinessStatus;
  checks: Record<string, { status: DependencyStatus }>;
}

export interface ReadinessService {
  check(): Promise<ReadinessReport>;
  markShuttingDown(): void;
}

const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

async function withTimeout(run: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createReadinessService(
  dependencies: Record<string, Dependency>,
  logger: Logger,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
): ReadinessService {
  let shuttingDown = false;

  return {
    markShuttingDown() {
      shuttingDown = true;
    },

    async check() {
      if (shuttingDown) {
        return { status: 'shutting_down', checks: {} };
      }

      const results = await Promise.all(
        Object.entries(dependencies).map(async ([name, dependency]) => {
          try {
            await withTimeout(dependency.check, timeoutMs);
            return { name, critical: dependency.critical, status: 'up' as const };
          } catch (err) {
            logger.warn({ err, dependency: name }, 'Readiness check failed');
            return { name, critical: dependency.critical, status: 'down' as const };
          }
        }),
      );

      const down = results.filter((r) => r.status === 'down');
      const status: ReadinessStatus = down.some((r) => r.critical)
        ? 'error'
        : down.length > 0
          ? 'degraded'
          : 'ok';

      return {
        status,
        checks: Object.fromEntries(results.map((r) => [r.name, { status: r.status }])),
      };
    },
  };
}
