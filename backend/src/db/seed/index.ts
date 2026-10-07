import { createProcessLogger, loadEnvOrExit } from '../../shared/lifecycle/index.js';
import { connectMongo, disconnectMongo } from '../connect.js';
import { runMigrations } from '../migrate.js';
import { seedDatabase } from './seed.js';

// `npm run db:seed` (02 §3). Idempotent: existing records are left alone. Writes directly (no
// audit rows): seed data is not a business action. Refuses to run in production.

const env = loadEnvOrExit('api');
if (!env) process.exit(1);
const logger = createProcessLogger(env, 'api');

if (env.NODE_ENV === 'production') {
  logger.fatal('Refusing to seed: NODE_ENV=production');
  process.exit(1);
}

try {
  await runMigrations(env.MONGO_URI, logger);
  await connectMongo(env.MONGO_URI, logger);
  await seedDatabase({ logger, bcryptCost: env.BCRYPT_COST });
  await disconnectMongo();
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
}
