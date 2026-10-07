// @ts-check
// Phase 7: reviews (02-database §2.12) and daily_stats (§2.17).
// Must match the Mongoose schema indexes: test/integration/migrations.int.test.ts checks this.

/** @typedef {import('mongoose').mongo.Db} Db */
/** @typedef {import('mongoose').mongo.IndexDescription} IndexDescription */

/** @type {IndexDescription[]} */
const REVIEWS = [
  { key: { bookingId: 1 }, unique: true },
  { key: { staffId: 1, isHidden: 1, createdAt: -1 } }, // API-061 by stylist, ratings
  { key: { serviceIds: 1, isHidden: 1, createdAt: -1 } }, // API-061 by service, ratings
  { key: { isHidden: 1, createdAt: -1 } }, // API-061 unfiltered
];

/** @type {IndexDescription[]} */
const DAILY_STATS = [{ key: { date: 1, staffId: 1 }, unique: true }];

/** @param {Db} db */
export async function up(db) {
  await db.collection('reviews').createIndexes(REVIEWS);
  await db.collection('daily_stats').createIndexes(DAILY_STATS);
}

/** @param {Db} db */
export async function down(db) {
  await db.collection('reviews').dropIndexes();
  await db.collection('daily_stats').dropIndexes();
}
