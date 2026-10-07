// @ts-check
// Phase 5: bookings (02-database §2.11).
// Must match the Mongoose schema indexes: test/integration/migrations.int.test.ts checks this.

/** @typedef {import('mongoose').mongo.Db} Db */
/** @typedef {import('mongoose').mongo.IndexDescription} IndexDescription */

/** @type {IndexDescription[]} */
const BOOKINGS = [
  { key: { bookingRef: 1 }, unique: true },
  { key: { staffId: 1, startAt: 1 } },
  { key: { customerId: 1, startAt: -1 } },
  { key: { status: 1, startAt: 1 } },
  { key: { startAt: 1 } },
];

/** @param {Db} db */
export async function up(db) {
  await db.collection('bookings').createIndexes(BOOKINGS);
}

/** @param {Db} db */
export async function down(db) {
  await db.collection('bookings').dropIndexes();
}
