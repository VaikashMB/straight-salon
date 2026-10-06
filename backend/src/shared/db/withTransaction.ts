import type { ClientSession, Connection } from 'mongoose';

export type TransactionWork<T> = (session: ClientSession) => Promise<T>;

// Runs `work` in a MongoDB transaction and returns its result. Mongoose's connection.transaction
// uses the driver's withTransaction, which retries the whole callback on TransientTransactionError
// (e.g. write conflicts) and retries the commit on UnknownTransactionCommitResult. `work` must
// therefore be safe to run more than once: do all writes through `session`, no side effects
// outside the database (those go through the outbox, 09 §4).
export async function withTransaction<T>(
  connection: Connection,
  work: TransactionWork<T>,
): Promise<T> {
  return connection.transaction(work);
}
