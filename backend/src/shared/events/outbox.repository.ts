import mongoose, { type ClientSession, type Types } from 'mongoose';
import type { DomainEvent } from './envelope.js';
import { OutboxModel, type OutboxDoc } from './outbox.model.js';

export interface ClaimedEvent {
  id: Types.ObjectId;
  attempts: number;
  event: DomainEvent;
}

export interface OutboxRepository {
  insert(event: DomainEvent, session: ClientSession): Promise<void>;
  // Oldest PENDING ids, without claiming them.
  findPendingIds(limit: number): Promise<Types.ObjectId[]>;
  // Atomically PENDING -> PUBLISHING; null if another relay claimed it first (09 §4 step 2).
  claim(id: Types.ObjectId, now: Date): Promise<ClaimedEvent | null>;
  markPublished(id: Types.ObjectId, now: Date): Promise<void>;
  markFailedAttempt(id: Types.ObjectId, error: string, giveUp: boolean): Promise<void>;
  // PUBLISHING claims older than `before` go back to PENDING (relay crashed mid-publish).
  resetStaleClaims(before: Date): Promise<number>;
  countPending(): Promise<number>;
}

function toEvent(doc: OutboxDoc): DomainEvent {
  const event: DomainEvent = {
    eventId: doc.eventId,
    type: doc.type,
    version: doc.version,
    occurredAt: doc.occurredAt.toISOString(),
    aggregateType: doc.aggregateType,
    aggregateId: doc.aggregateId,
    actor: { id: doc.actor.id, role: doc.actor.role },
    correlationId: doc.correlationId,
    payload: doc.payload,
  };
  if (doc.secret?.data) event.secret = doc.secret;
  return event;
}

export const outboxRepository: OutboxRepository = {
  async insert(event, session) {
    await OutboxModel.create(
      [{ ...event, occurredAt: new Date(event.occurredAt), status: 'PENDING', attempts: 0 }],
      { session },
    );
  },

  async findPendingIds(limit) {
    const rows = await OutboxModel.find({ status: 'PENDING' }, { _id: 1 })
      .sort({ occurredAt: 1 })
      .limit(limit)
      .lean<{ _id: Types.ObjectId }[]>();
    return rows.map((row) => row._id);
  },

  async claim(id, now) {
    const doc = await OutboxModel.findOneAndUpdate(
      { _id: id, status: 'PENDING' },
      { $set: { status: 'PUBLISHING', claimedAt: now } },
      { returnDocument: 'after' },
    ).lean<OutboxDoc & { _id: Types.ObjectId }>();
    return doc ? { id: doc._id, attempts: doc.attempts, event: toEvent(doc) } : null;
  },

  async markPublished(id, now) {
    await OutboxModel.updateOne(
      { _id: id },
      { $set: { status: 'PUBLISHED', publishedAt: now }, $unset: { lastError: 1 } },
    );
  },

  async markFailedAttempt(id, error, giveUp) {
    await OutboxModel.updateOne(
      { _id: id },
      {
        $set: { status: giveUp ? 'FAILED' : 'PENDING', lastError: error.slice(0, 1000) },
        $inc: { attempts: 1 },
      },
    );
  },

  async resetStaleClaims(before) {
    const result = await OutboxModel.updateMany(
      // Operator objects written in code are wrapped in trusted(): sanitizeFilter is on (06 §4).
      { status: 'PUBLISHING', claimedAt: mongoose.trusted({ $lt: before }) },
      { $set: { status: 'PENDING' } },
    );
    return result.modifiedCount;
  },

  async countPending() {
    return OutboxModel.countDocuments({
      status: mongoose.trusted({ $in: ['PENDING', 'PUBLISHING'] }),
    });
  },
};
