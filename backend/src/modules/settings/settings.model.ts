import mongoose, { Schema } from 'mongoose';

// settings singleton, `_id: "salon"` (02-database §2.10)

export const SETTINGS_ID = 'salon';

export interface BusinessHours {
  dayOfWeek: number; // 0 = Sunday
  isOpen: boolean;
  open: string; // "HH:mm", salon timezone
  close: string;
}

export interface SettingsFields {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  timezone: string; // IANA
  currency: string; // ISO 4217
  businessHours: BusinessHours[]; // 7 entries, sorted by dayOfWeek
  slotGranularityMin: number;
  bufferMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  cancellationCutoffMin: number;
  noShowGraceMin: number;
  reviewWindowDays: number;
}

export interface SettingsDoc extends SettingsFields {
  _id: typeof SETTINGS_ID;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}

const businessHoursSchema = new Schema<BusinessHours>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    isOpen: { type: Boolean, required: true },
    open: { type: String, required: true },
    close: { type: String, required: true },
  },
  { _id: false },
);

const settingsSchema = new Schema<SettingsDoc>(
  {
    _id: { type: String, default: SETTINGS_ID },
    name: { type: String, required: true, trim: true },
    address: String,
    phone: String,
    email: String,
    timezone: { type: String, required: true },
    currency: { type: String, required: true },
    businessHours: { type: [businessHoursSchema], required: true },
    slotGranularityMin: { type: Number, required: true },
    bufferMin: { type: Number, required: true },
    minLeadTimeMin: { type: Number, required: true },
    maxAdvanceDays: { type: Number, required: true },
    cancellationCutoffMin: { type: Number, required: true },
    noShowGraceMin: { type: Number, required: true },
    reviewWindowDays: { type: Number, required: true },
  },
  { collection: 'settings', timestamps: true, optimisticConcurrency: true },
);

export const SettingsModel =
  (mongoose.models.Settings as mongoose.Model<SettingsDoc> | undefined) ??
  mongoose.model<SettingsDoc>('Settings', settingsSchema);

// FR-080 defaults; also what the API serves before an admin has saved settings.
export const DEFAULT_SETTINGS: SettingsFields = {
  name: 'Straight Salon',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    open: '09:30',
    close: '20:30',
  })),
  slotGranularityMin: 15,
  bufferMin: 0,
  minLeadTimeMin: 60,
  maxAdvanceDays: 30,
  cancellationCutoffMin: 120,
  noShowGraceMin: 30,
  reviewWindowDays: 14,
};
