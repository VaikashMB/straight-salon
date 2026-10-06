import { createProcessLogger, loadEnvOrExit } from '../shared/lifecycle/index.js';
import { runMigrations } from './migrate.js';

// `npm run db:migrate` (dev, tsx) or `node dist/db/runMigrations.js` (image / one-off job).
const env = loadEnvOrExit('api');
if (!env) process.exit(1);
const logger = createProcessLogger(env, 'api');

try {
  await runMigrations(env.MONGO_URI, logger);
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, 'Migration failed');
  process.exit(1);
}
