// @ts-check
// Phase 4 collections (02-database §2.4–2.10): categories, services, staff, schedules, time-off,
// holidays. `settings` is a singleton keyed by _id and needs no extra index.
// Must match the Mongoose schema indexes: test/integration/migrations.int.test.ts checks this.

/** @typedef {import('mongoose').mongo.Db} Db */
/** @typedef {import('mongoose').mongo.IndexDescription} IndexDescription */

/** @type {Record<string, IndexDescription[]>} */
const INDEXES = {
  service_categories: [
    { key: { name: 1 }, unique: true },
    { key: { slug: 1 }, unique: true },
  ],
  services: [
    { key: { slug: 1 }, unique: true },
    { key: { categoryId: 1, isActive: 1 } },
    { key: { name: 'text', description: 'text' } },
    { key: { name: 1 }, unique: true, partialFilterExpression: { isActive: true } },
  ],
  staff: [
    { key: { userId: 1 }, unique: true },
    { key: { serviceIds: 1, isActive: 1 } },
    { key: { isActive: 1, displayName: 1 } },
  ],
  staff_schedules: [{ key: { staffId: 1 }, unique: true }],
  time_off: [{ key: { staffId: 1, startAt: 1, endAt: 1 } }],
  holidays: [{ key: { date: 1 }, unique: true }],
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
    await db.collection(collection).dropIndexes();
  }
}
