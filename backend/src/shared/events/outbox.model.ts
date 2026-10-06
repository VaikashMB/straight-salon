import mongoose, { Schema } from 'mongoose';
import type { DomainEvent } from './envelope.js';

// outbox_events (02-database §2.15). Each row stores the full event envelope plus delivery state.
export const OUTBOX_STATUSES = ['PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxDoc extends Omit<DomainEvent, 'occurredAt'> {
  occurredAt: Date;
  status: OutboxStatus;
  attempts: number;
  claimedAt?: Date;
  publishedAt?: Date;
  lastError?: string;
}

const outboxSchema = new Schema<OutboxDoc>(
  {
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    version: { type: Number, required: true },
    occurredAt: { type: Date, required: true },
    aggregateType: { type: String, required: true },
    aggregateId: { type: String, required: true },
    actor: { id: { type: String, required: true }, role: { type: String, required: true } },
    correlationId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    secret: { iv: String, tag: String, data: String },
    status: { type: String, enum: OUTBOX_STATUSES, required: true, default: 'PENDING' },
    attempts: { type: Number, required: true, default: 0 },
    claimedAt: Date,
    publishedAt: Date,
    lastError: String,
  },
  { collection: 'outbox_events', versionKey: false, minimize: false },
);

outboxSchema.index({ eventId: 1 }, { unique: true });
outboxSchema.index({ status: 1, occurredAt: 1 });
outboxSchema.index({ status: 1, claimedAt: 1 });
// Published rows are deleted after 7 days; FAILED rows are kept for the cleanup job (09 §7).
outboxSchema.index({ publishedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const OutboxModel =
  (mongoose.models.OutboxEvent as mongoose.Model<OutboxDoc> | undefined) ??
  mongoose.model<OutboxDoc>('OutboxEvent', outboxSchema);
