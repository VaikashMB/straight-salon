import { fileURLToPath } from 'node:url';
import { config, database, up } from 'migrate-mongo';
import type { Logger } from '../shared/logger/index.js';

// Schema migrations with migrate-mongo (02 §1). Migrations live in ./migrations as plain ESM
// .js files (type-checked with JSDoc), copied as-is into the compiled image. Run with `npm run db:migrate`, or automatically on API
// start when MIGRATE_ON_START=true (dev default, 12 §4). In production they run as a one-off job.

export const CHANGELOG_COLLECTION = 'changelog';
export const LOCK_COLLECTION = 'changelog_lock';

const LOCK_ID = 'migrate';
const LOCK_TTL_SECONDS = 300; // a crashed migrator cannot block others for longer than this

// Our own lock instead of migrate-mongo's: theirs checks-then-inserts (two instances can both
// pass) and fires createIndex without awaiting it (closing the client afterwards caused an
// unhandled rejection). Here a fixed _id makes acquisition atomic and every call is awaited.
export async function runMigrations(mongoUri: string, logger: Logger): Promise<string[]> {
  config.set({
    mongodb: { url: mongoUri },
    migrationsDir: fileURLToPath(new URL('./migrations', import.meta.url)),
    changelogCollectionName: CHANGELOG_COLLECTION,
    lockTtl: 0, // disables migrate-mongo's built-in lock
    // Always .js (plain ESM migrations): the changelog file name must not depend on how we run.
    migrationFileExtension: '.js',
    useFileHash: false,
    moduleSystem: 'esm',
  });

  const { db, client } = await database.connect();
  const lock = db.collection<{ _id: string; createdAt: Date }>(LOCK_COLLECTION);
  try {
    await lock.createIndex({ createdAt: 1 }, { expireAfterSeconds: LOCK_TTL_SECONDS });
    try {
      await lock.insertOne({ _id: LOCK_ID, createdAt: new Date() });
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) {
        logger.warn('Migrations are running in another instance; continuing');
        return [];
      }
      throw err;
    }
    try {
      const applied = await up(db, client);
      if (applied.length > 0) logger.info({ applied }, 'Migrations applied');
      else logger.info('Database schema is up to date');
      return applied;
    } finally {
      await lock.deleteOne({ _id: LOCK_ID });
    }
  } finally {
    await client.close();
  }
}
