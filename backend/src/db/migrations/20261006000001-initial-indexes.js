// @ts-check
// Indexes for every collection that exists after Phase 3 (02-database §2.1–2.3, 2.14–2.16, 2.18).
// Must match the Mongoose schema indexes: test/integration/migrations.int.test.ts checks this.
// Migrations are plain ESM .js (type-checked via JSDoc) so the changelog records the same file
// name whether run from source (tsx) or from the compiled image (02 §1).

/** @typedef {import('mongoose').mongo.Db} Db */
/** @typedef {import('mongoose').mongo.IndexDescription} IndexDescription */

const DAY = 24 * 60 * 60;

/** @type {Record<string, IndexDescription[]>} */
const INDEXES = {
  users: [
    { key: { email: 1 }, unique: true, sparse: true },
    { key: { phone: 1 }, unique: true },
    { key: { role: 1, isActive: 1 } },
    { key: { name: 'text' } },
  ],
  refresh_tokens: [
    { key: { tokenHash: 1 }, unique: true },
    { key: { userId: 1 } },
    { key: { family: 1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  password_reset_tokens: [
    { key: { tokenHash: 1 }, unique: true },
    { key: { userId: 1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
  audit_logs: [
    { key: { entityType: 1, entityId: 1, at: -1 } },
    { key: { 'actor.id': 1, at: -1 } },
    { key: { action: 1, at: -1 } },
    { key: { at: -1 } },
  ],
  outbox_events: [
    { key: { eventId: 1 }, unique: true },
    { key: { status: 1, occurredAt: 1 } },
    { key: { status: 1, claimedAt: 1 } },
    { key: { publishedAt: 1 }, expireAfterSeconds: 7 * DAY },
  ],
  processed_events: [
    { key: { consumer: 1, eventId: 1 }, unique: true },
    { key: { processedAt: 1 }, expireAfterSeconds: 7 * DAY },
  ],
  staff_day_guards: [{ key: { staffId: 1, date: 1 }, unique: true }],
};

/** @param {Db} db */
export async function up(db) {
  for (const [collection, indexes] of Object.entries(INDEXES)) {
    await db.collection(collection).createIndexes(indexes);
  }
}

/** @param {Db} db */
export async function down(db) {
  for (const collection of Object.keys(INDEXES)) {
    const existing = await db.collection(collection).indexes();
    for (const index of existing) {
      if (index.name && index.name !== '_id_')
        await db.collection(collection).dropIndex(index.name);
    }
  }
}
