import { createPasswordHasher } from '../../shared/auth/password.js';
import { createProcessLogger, loadEnvOrExit } from '../../shared/lifecycle/index.js';
import { usersRepository } from '../../modules/users/users.repository.js';
import { connectMongo, disconnectMongo } from '../connect.js';
import { runMigrations } from '../migrate.js';

// `npm run db:seed` (02 §3). Idempotent: existing records are left alone. Grows with the build
// plan; Phase 3 seeds the admin account. Writes directly (no audit rows): seed data is not a
// business action. Refuses to run in production.

const SEED_PASSWORD = 'Password@123'; // dev/e2e only (02 §3)
const SEED_ADMIN = {
  name: 'Salon Admin',
  email: 'admin@straightsalon.local',
  phone: '+919000000001',
};

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
  const hasher = createPasswordHasher(env.BCRYPT_COST);

  if (await usersRepository.findByEmail(SEED_ADMIN.email)) {
    logger.info({ user: 'admin' }, 'Seed: admin already exists');
  } else {
    await usersRepository.create({
      ...SEED_ADMIN,
      passwordHash: await hasher.hash(SEED_PASSWORD),
      role: 'ADMIN',
      isWalkIn: false,
    });
    logger.info(
      { user: 'admin' },
      'Seed: admin created (admin@straightsalon.local / Password@123)',
    );
  }

  await disconnectMongo();
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
}
