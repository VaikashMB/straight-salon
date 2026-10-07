import { Types, type QueryFilter } from 'mongoose';
import {
  NotificationModel,
  type NotificationChannel,
  type NotificationContent,
  type NotificationDoc,
  type NotificationStatus,
} from './notifications.model.js';
import type { TemplateName } from './templates/index.js';

// All Mongoose access for notifications.

export interface NewNotification {
  userId: string;
  channel: NotificationChannel;
  template: TemplateName;
  to: string;
  payload: NotificationContent;
  provider: string;
  dedupeKey: string;
}

export interface NotificationSearch {
  userId?: string;
  channel?: NotificationChannel;
  status?: NotificationStatus;
  template?: TemplateName;
  skip: number;
  limit: number;
}

export interface NotificationsRepository {
  // The row for `dedupeKey`, created as QUEUED if it does not exist yet.
  reserve(input: NewNotification): Promise<NotificationDoc>;
  markSent(id: Types.ObjectId, providerMessageId: string, at: Date): Promise<void>;
  markFailed(id: Types.ObjectId, error: string): Promise<void>;
  search(search: NotificationSearch): Promise<{ data: NotificationDoc[]; total: number }>;
}

export const notificationsRepository: NotificationsRepository = {
  async reserve(input) {
    const filter = { dedupeKey: input.dedupeKey };
    const insert = {
      ...input,
      userId: new Types.ObjectId(input.userId),
      status: 'QUEUED',
      attempts: 0,
    };
    try {
      return await NotificationModel.findOneAndUpdate(
        filter,
        { $setOnInsert: insert },
        { upsert: true, returnDocument: 'after' },
      )
        .lean<NotificationDoc>()
        .orFail();
    } catch (err) {
      // Two deliveries raced to insert the same key: the other one won; read its row.
      if ((err as { code?: unknown }).code !== 11000) throw err;
      return NotificationModel.findOne(filter).lean<NotificationDoc>().orFail();
    }
  },

  async markSent(id, providerMessageId, at) {
    await NotificationModel.updateOne(
      { _id: id },
      {
        $set: { status: 'SENT', providerMessageId, sentAt: at },
        $unset: { error: 1 },
        $inc: { attempts: 1 },
      },
    );
  },

  async markFailed(id, error) {
    await NotificationModel.updateOne(
      { _id: id },
      { $set: { status: 'FAILED', error: error.slice(0, 1000) }, $inc: { attempts: 1 } },
    );
  },

  async search({ skip, limit, ...criteria }) {
    const filter: QueryFilter<NotificationDoc> = {};
    if (criteria.userId) filter.userId = new Types.ObjectId(criteria.userId);
    if (criteria.channel) filter.channel = criteria.channel;
    if (criteria.status) filter.status = criteria.status;
    if (criteria.template) filter.template = criteria.template;
    const [data, total] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<NotificationDoc[]>(),
      NotificationModel.countDocuments(filter),
    ]);
    return { data, total };
  },
};
