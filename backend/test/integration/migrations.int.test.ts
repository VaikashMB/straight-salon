import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CHANGELOG_COLLECTION, LOCK_COLLECTION, runMigrations } from '../../src/db/migrate.js';
import '../../src/modules/index.js'; // registers every model
import { captureLogger } from '../helpers/logger.js';

// Migrations run against an empty database with Mongoose autoIndex off, so every index here
// comes from the migration. It must match what the schemas declare (02 §1).
let uri: string;

beforeAll(async () => {
  const url = new URL(inject('mongoUri'));
  url.pathname = `/migrations_${Date.now()}`;
  uri = url.toString();
  await mongoose.connect(uri, { autoIndex: false });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const normalise = (key: Record<string, unknown>) => JSON.stringify(Object.entries(key));

describe('migrations (02 §1)', () => {
  it('create every schema index, then are idempotent', async () => {
    const { logger, lines } = captureLogger();
    const applied = await runMigrations(uri, logger);
    expect(applied).toEqual([
      '20261006000001-initial-indexes.js',
      '20261006000002-catalog-staff-indexes.js',
      '20261007000003-bookings-indexes.js',
      '20261007000004-notifications-indexes.js',
    ]);

    for (const model of Object.values(mongoose.models)) {
      if (model.modelName.startsWith('Probe')) continue; // test-only models from other files
      const actual = await model.collection.indexes();
      for (const [key, options] of model.schema.indexes()) {
        const match = actual.find(
          (index) =>
            normalise(index.key as Record<string, unknown>) ===
              normalise(key as Record<string, unknown>) ||
            (index.textIndexVersion && Object.values(key).includes('text')),
        );
        expect(match, `${model.collection.collectionName} ${JSON.stringify(key)}`).toBeDefined();
        if (options.unique) expect(match?.unique, `${JSON.stringify(key)} unique`).toBe(true);
        if (options.expireAfterSeconds !== undefined)
          expect(match?.expireAfterSeconds).toBe(options.expireAfterSeconds);
        if (options.sparse) expect(match?.sparse).toBe(true);
        if (options.partialFilterExpression)
          expect(match?.partialFilterExpression).toEqual(options.partialFilterExpression);
      }
    }

    expect(await runMigrations(uri, logger)).toEqual([]);
    expect(lines().some((l) => l.msg === 'Database schema is up to date')).toBe(true);
    const changelog = await mongoose.connection.collection(CHANGELOG_COLLECTION).find().toArray();
    expect(changelog.map((c) => c.fileName as string)).toEqual([
      '20261006000001-initial-indexes.js',
      '20261006000002-catalog-staff-indexes.js',
      '20261007000003-bookings-indexes.js',
      '20261007000004-notifications-indexes.js',
    ]);
  });

  it('another instance holding the lock is not an error', async () => {
    const { logger, lines } = captureLogger();
    await mongoose.connection
      .collection<{ _id: string; createdAt: Date }>(LOCK_COLLECTION)
      .insertOne({ _id: 'migrate', createdAt: new Date() });
    // Pretend a new migration is pending by removing the changelog entry.
    await mongoose.connection.collection(CHANGELOG_COLLECTION).deleteMany({});
    await expect(runMigrations(uri, logger)).resolves.toEqual([]);
    expect(
      lines().some(
        (l) =>
          l.level === 'warn' && l.msg === 'Migrations are running in another instance; continuing',
      ),
    ).toBe(true);
    await mongoose.connection.collection(LOCK_COLLECTION).deleteMany({});
  });

  it('only one of several concurrent runs migrates; the lock is released afterwards', async () => {
    await mongoose.connection.collection(CHANGELOG_COLLECTION).deleteMany({});
    const { logger } = captureLogger();
    const results = await Promise.all([
      runMigrations(uri, logger),
      runMigrations(uri, logger),
      runMigrations(uri, logger),
    ]);
    expect(results.filter((r) => r.length === 4)).toHaveLength(1);
    expect(results.filter((r) => r.length === 0)).toHaveLength(2);
    expect(await mongoose.connection.collection(CHANGELOG_COLLECTION).countDocuments()).toBe(4);
    expect(await mongoose.connection.collection(LOCK_COLLECTION).countDocuments()).toBe(0);
  });
});
