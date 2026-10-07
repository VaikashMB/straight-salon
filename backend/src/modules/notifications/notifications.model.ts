import mongoose, { Schema, type Types } from 'mongoose';
import { TEMPLATE_NAMES, type TemplateName } from './templates/index.js';

// notifications (02-database §2.13): one row per message per channel. `dedupeKey`
// (eventId:channel:template) makes delivery idempotent across retries (09 §6).

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// The rendered message as stored, secrets redacted (e.g. the password-reset link).
export interface NotificationContent {
  subject?: string;
  text: string;
  html?: string;
}

export interface NotificationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  channel: NotificationChannel;
  template: TemplateName;
  to: string;
  payload: NotificationContent;
  status: NotificationStatus;
  provider: string;
  providerMessageId?: string;
  error?: string;
  attempts: number;
  sentAt?: Date;
  dedupeKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export const NOTIFICATION_TTL_SECONDS = 180 * 24 * 60 * 60;

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    template: { type: String, enum: TEMPLATE_NAMES, required: true },
    to: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true, default: 'QUEUED' },
    provider: { type: String, required: true },
    providerMessageId: String,
    error: String,
    attempts: { type: Number, required: true, default: 0 },
    sentAt: Date,
    dedupeKey: { type: String, required: true },
  },
  { collection: 'notifications', timestamps: true, minimize: false },
);

notificationSchema.index({ dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 }); // API-065
// 180-day retention; also serves API-066's newest-first listing.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

export const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<NotificationDoc> | undefined) ??
  mongoose.model<NotificationDoc>('Notification', notificationSchema);
