import mongoose, { Schema, type Types } from 'mongoose';

// staff, staff_schedules, time_off (02-database §2.6–2.8)

export interface StaffDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId; // users with role STAFF
  displayName: string;
  bio?: string;
  photoUrl?: string;
  serviceIds: Types.ObjectId[];
  isActive: boolean;
  ratingAvg: number; // denormalised by the ratings consumer (FR-061)
  ratingCount: number;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeRange {
  start: string; // "HH:mm", salon timezone
  end: string;
}

export interface ScheduleDay extends TimeRange {
  dayOfWeek: number; // 0 = Sunday
  isWorking: boolean;
  breaks: TimeRange[];
}

export interface StaffScheduleDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  weekly: ScheduleDay[]; // exactly 7, sorted by dayOfWeek
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeOffDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  startAt: Date; // UTC
  endAt: Date;
  reason?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const staffSchema = new Schema<StaffDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    bio: { type: String, maxlength: 500 },
    photoUrl: String,
    serviceIds: { type: [Schema.Types.ObjectId], default: [] },
    isActive: { type: Boolean, required: true, default: true },
    ratingAvg: { type: Number, required: true, default: 0 },
    ratingCount: { type: Number, required: true, default: 0 },
  },
  { collection: 'staff', timestamps: true, optimisticConcurrency: true },
);

staffSchema.index({ userId: 1 }, { unique: true });
staffSchema.index({ serviceIds: 1, isActive: 1 });
staffSchema.index({ isActive: 1, displayName: 1 }); // public list, sorted

const rangeSchema = new Schema<TimeRange>(
  { start: { type: String, required: true }, end: { type: String, required: true } },
  { _id: false },
);

const scheduleSchema = new Schema<StaffScheduleDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, required: true },
    weekly: {
      type: [
        new Schema<ScheduleDay>(
          {
            dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
            isWorking: { type: Boolean, required: true },
            start: { type: String, required: true },
            end: { type: String, required: true },
            breaks: { type: [rangeSchema], default: [] },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
  },
  { collection: 'staff_schedules', timestamps: true },
);

scheduleSchema.index({ staffId: 1 }, { unique: true });

// Hard-deleted on DELETE (02 §1, decision 2026-10-06); the audit row keeps the snapshot.
const timeOffSchema = new Schema<TimeOffDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    reason: { type: String, maxlength: 200 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'time_off', timestamps: true },
);

timeOffSchema.index({ staffId: 1, startAt: 1, endAt: 1 });

export const StaffModel =
  (mongoose.models.Staff as mongoose.Model<StaffDoc> | undefined) ??
  mongoose.model<StaffDoc>('Staff', staffSchema);

export const StaffScheduleModel =
  (mongoose.models.StaffSchedule as mongoose.Model<StaffScheduleDoc> | undefined) ??
  mongoose.model<StaffScheduleDoc>('StaffSchedule', scheduleSchema);

export const TimeOffModel =
  (mongoose.models.TimeOff as mongoose.Model<TimeOffDoc> | undefined) ??
  mongoose.model<TimeOffDoc>('TimeOff', timeOffSchema);
