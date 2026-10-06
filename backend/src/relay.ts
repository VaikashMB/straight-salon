import { connectMongo, disconnectMongo } from './db/connect.js';
import { createProcessLogger, loadEnvOrExit, registerShutdown } from './shared/lifecycle/index.js';
import { startOutboxRelay } from './workers/outboxRelay.js';

// Standalone outbox relay process (01-architecture §1), for when it runs separately from the
// worker (RUN_RELAY_IN_WORKER=false), e.g. its own Kubernetes Deployment later.
const env = loadEnvOrExit('relay');
if (!env) process.exit(1);

const logger = createProcessLogger(env, 'relay');

await connectMongo(env.MONGO_URI, logger).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot connect to MongoDB at startup; exiting');
  process.exit(1);
});

const { relay, bus } = startOutboxRelay(env, logger);

registerShutdown(logger, [
  { name: 'relay', run: () => relay.stop() },
  { name: 'event-bus', run: () => bus.close() },
  { name: 'mongo', run: disconnectMongo },
]);
