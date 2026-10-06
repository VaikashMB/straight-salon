import mongoose, { Schema } from 'mongoose';
import type { Logger } from '../logger/index.js';
import type { EventHandler } from './EventBus.js';

// Consumer idempotency (09 §6). Delivery is at-least-once, so every consumer is wrapped:
// 1. insert processed_events {consumer, eventId} (unique) — a duplicate means "already done";
// 2. run the handler; if it throws, delete the row so the retry can run it again.

interface ProcessedEventDoc {
  consumer: string;
  eventId: string;
  processedAt: Date;
}

const processedEventSchema = new Schema<ProcessedEventDoc>(
  {
    consumer: { type: String, required: true },
    eventId: { type: String, required: true },
    processedAt: { type: Date, required: true },
  },
  { collection: 'processed_events', versionKey: false },
);
processedEventSchema.index({ consumer: 1, eventId: 1 }, { unique: true });
processedEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const ProcessedEventModel =
  (mongoose.models.ProcessedEvent as mongoose.Model<ProcessedEventDoc> | undefined) ??
  mongoose.model<ProcessedEventDoc>('ProcessedEvent', processedEventSchema);

export interface ProcessedEventsRepository {
  // false when the row already exists (event already processed by this consumer)
  tryInsert(consumer: string, eventId: string, at: Date): Promise<boolean>;
  remove(consumer: string, eventId: string): Promise<void>;
}

export const processedEventsRepository: ProcessedEventsRepository = {
  async tryInsert(consumer, eventId, at) {
    try {
      await ProcessedEventModel.create({ consumer, eventId, processedAt: at });
      return true;
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) return false;
      throw err;
    }
  },
  async remove(consumer, eventId) {
    await ProcessedEventModel.deleteOne({ consumer, eventId });
  },
};

export function idempotent(
  consumer: string,
  handler: EventHandler,
  {
    repository = processedEventsRepository,
    logger,
    now = () => new Date(),
  }: {
    repository?: ProcessedEventsRepository;
    logger: Logger;
    now?: () => Date;
  },
): EventHandler {
  return async (event) => {
    if (!(await repository.tryInsert(consumer, event.eventId, now()))) {
      logger.debug({ consumer, eventId: event.eventId }, 'Duplicate delivery ignored');
      return;
    }
    try {
      await handler(event);
    } catch (err) {
      await repository.remove(consumer, event.eventId);
      throw err;
    }
  };
}
