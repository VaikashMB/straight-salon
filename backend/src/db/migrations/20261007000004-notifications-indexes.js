// @ts-check
// Phase 6: notifications (02-database §2.13).
// Must match the Mongoose schema indexes: test/integration/migrations.int.test.ts checks this.

/** @typedef {import('mongoose').mongo.Db} Db */
/** @typedef {import('mongoose').mongo.IndexDescription} IndexDescription */

/** @type {IndexDescription[]} */
const NOTIFICATIONS = [
  { key: { dedupeKey: 1 }, unique: true },
  { key: { userId: 1, createdAt: -1 } },
  // 180-day retention; also serves the admin list (API-066), newest first.
  { key: { createdAt: 1 }, expireAfterSeconds: 180 * 24 * 60 * 60 },
];

/** @param {Db} db */
export async function up(db) {
  await db.collection('notifications').createIndexes(NOTIFICATIONS);
}

/** @param {Db} db */
export async function down(db) {
  await db.collection('notifications').dropIndexes();
}
