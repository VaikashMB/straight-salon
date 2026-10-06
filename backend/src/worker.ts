import { connectMongo, disconnectMongo } from './db/connect.js';
import {
  createProcessLogger,
  loadEnvOrExit,
  registerShutdown,
  type ShutdownStep,
} from './shared/lifecycle/index.js';
import { startOutboxRelay } from './workers/outboxRelay.js';

// Worker process (01-architecture §1). Runs the outbox relay when RUN_RELAY_IN_WORKER=true.
// Queue consumers and scheduled jobs are registered here in Phase 6.
const env = loadEnvOrExit('worker');
if (!env) process.exit(1);

const logger = createProcessLogger(env, 'worker');

await connectMongo(env.MONGO_URI, logger).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot connect to MongoDB at startup; exiting');
  process.exit(1);
});

const steps: ShutdownStep[] = [];
if (env.RUN_RELAY_IN_WORKER) {
  const { relay, bus } = startOutboxRelay(env, logger);
  steps.push(
    { name: 'relay', run: () => relay.stop() },
    { name: 'event-bus', run: () => bus.close() },
  );
}
steps.push({ name: 'mongo', run: disconnectMongo });

logger.info({ relay: env.RUN_RELAY_IN_WORKER }, 'Worker started (no consumers registered yet)');
registerShutdown(logger, steps);
