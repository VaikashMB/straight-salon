// MongoDB bootstrap for local Docker (docs/specs/11-docker-local-dev.md §6).
// Run by the one-shot `mongo-init` service with mongosh on every `docker compose up`.
// Idempotent: safe to run against an already initialised replica set.
//
// Env:
//   MONGO_RS_HOST       host:port the replica-set member advertises (default mongo:27017)
//   MONGO_DB_NAME       application database (default straight_salon)
//   MONGO_AUTH          "true" to create roles + the app user (requires mongod --auth/--keyFile,
//                       see docker-compose.auth.yml); anything else skips user management
//   MONGO_APP_USER      application user (default ss_app)
//   MONGO_APP_PASSWORD  application user password (required when MONGO_AUTH=true)

/* global rs, db, print, sleep, process */

const RS_NAME = 'rs0';
const RS_HOST = process.env.MONGO_RS_HOST || 'mongo:27017';
const DB_NAME = process.env.MONGO_DB_NAME || 'straight_salon';
const AUTH_ENABLED = process.env.MONGO_AUTH === 'true';
const APP_USER = process.env.MONGO_APP_USER || 'ss_app';
const APP_PASSWORD = process.env.MONGO_APP_PASSWORD || '';

// Every collection the application writes, except audit_logs (02-database §2).
// Add new collections here (and in a migration) when the data model grows.
const APP_COLLECTIONS = [
  'users',
  'refresh_tokens',
  'password_reset_tokens',
  'service_categories',
  'services',
  'staff',
  'staff_schedules',
  'time_off',
  'holidays',
  'settings',
  'bookings',
  'reviews',
  'notifications',
  'outbox_events',
  'processed_events',
  'daily_stats',
  'staff_day_guards',
  'changelog', // migrate-mongo
  'changelog_lock', // migrate-mongo
];

const READ_WRITE_ACTIONS = [
  'find',
  'insert',
  'update',
  'remove',
  'createCollection',
  'createIndex',
  'dropIndex',
  'listIndexes',
  'collMod',
  'changeStream', // outbox relay (09 §4)
];

// Append-only: no update/remove (07-logging-and-auditing §2.3).
const AUDIT_ACTIONS = ['find', 'insert', 'createCollection', 'createIndex', 'listIndexes'];

function initiateReplicaSet() {
  try {
    const status = rs.status();
    print(`[mongo-init] replica set "${status.set}" already initiated`);
    return;
  } catch (err) {
    if (err.codeName !== 'NotYetInitialized') throw err;
  }
  rs.initiate({ _id: RS_NAME, members: [{ _id: 0, host: RS_HOST }] });
  print(`[mongo-init] replica set "${RS_NAME}" initiated with member ${RS_HOST}`);
}

function waitForPrimary(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!db.adminCommand({ hello: 1 }).isWritablePrimary) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a PRIMARY');
    sleep(500);
  }
  print('[mongo-init] PRIMARY is ready');
}

function upsertRole(appDb, name, privileges) {
  if (appDb.getRole(name)) {
    appDb.updateRole(name, { privileges, roles: [] });
    print(`[mongo-init] role ${name} updated`);
  } else {
    appDb.createRole({ role: name, privileges, roles: [] });
    print(`[mongo-init] role ${name} created`);
  }
}

function setUpRolesAndUser() {
  if (!APP_PASSWORD) throw new Error('MONGO_APP_PASSWORD is required when MONGO_AUTH=true');
  const appDb = db.getSiblingDB(DB_NAME);

  upsertRole(appDb, 'auditAppendOnly', [
    { resource: { db: DB_NAME, collection: 'audit_logs' }, actions: AUDIT_ACTIONS },
  ]);
  upsertRole(appDb, 'ssAppReadWrite', [
    { resource: { db: DB_NAME, collection: '' }, actions: ['listCollections'] },
    ...APP_COLLECTIONS.map((collection) => ({
      resource: { db: DB_NAME, collection },
      actions: READ_WRITE_ACTIONS,
    })),
  ]);

  const roles = ['ssAppReadWrite', 'auditAppendOnly'];
  if (appDb.getUser(APP_USER)) {
    appDb.updateUser(APP_USER, { pwd: APP_PASSWORD, roles });
    print(`[mongo-init] user ${APP_USER} updated`);
  } else {
    appDb.createUser({ user: APP_USER, pwd: APP_PASSWORD, roles });
    print(`[mongo-init] user ${APP_USER} created`);
  }
}

initiateReplicaSet();
waitForPrimary(30000);
if (AUTH_ENABLED) {
  setUpRolesAndUser();
} else {
  print('[mongo-init] MONGO_AUTH is not "true": skipping roles and users (local no-auth mode)');
}
print('[mongo-init] done');
