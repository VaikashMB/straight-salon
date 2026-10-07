import mongoose, { Schema, type Types } from 'mongoose';

// holidays (02-database §2.9): full-day closures. Hard-deleted (02 §1, decision 2026-10-06).
export interface HolidayDoc {
  _id: Types.ObjectId;
  date: string; // YYYY-MM-DD, salon timezone
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const holidaySchema = new Schema<HolidayDoc>(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 100 },
  },
  { collection: 'holidays', timestamps: true },
);

holidaySchema.index({ date: 1 }, { unique: true });

export const HolidayModel =
  (mongoose.models.Holiday as mongoose.Model<HolidayDoc> | undefined) ??
  mongoose.model<HolidayDoc>('Holiday', holidaySchema);
