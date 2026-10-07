import mongoose, { Schema, type Types } from 'mongoose';

// daily_stats (02-database §2.17): the reports read model. One row per salon-local date and
// stylist, plus the salon total (staffId null). Recomputed from bookings by the stats consumer,
// the stats-reconcile job and `npm run stats:rebuild`; never edited by hand.

export interface DailyServiceStat {
  serviceId: Types.ObjectId;
  count: number;
  revenueMinor: number;
}

export interface DailyStatsDoc {
  _id: Types.ObjectId;
  date: string; // YYYY-MM-DD, salon timezone
  staffId: Types.ObjectId | null;
  bookings: number;
  completed: number;
  cancelled: number;
  noShows: number;
  revenueMinor: number;
  bookedMinutes: number;
  availableMinutes: number;
  byService: DailyServiceStat[];
  createdAt: Date;
  updatedAt: Date;
}

const dailyStatsSchema = new Schema<DailyStatsDoc>(
  {
    date: { type: String, required: true },
    staffId: { type: Schema.Types.ObjectId, default: null },
    bookings: { type: Number, required: true },
    completed: { type: Number, required: true },
    cancelled: { type: Number, required: true },
    noShows: { type: Number, required: true },
    revenueMinor: { type: Number, required: true },
    bookedMinutes: { type: Number, required: true },
    availableMinutes: { type: Number, required: true },
    byService: {
      type: [
        new Schema<DailyServiceStat>(
          {
            serviceId: { type: Schema.Types.ObjectId, required: true },
            count: { type: Number, required: true },
            revenueMinor: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { collection: 'daily_stats', timestamps: true },
);

// Also serves the range reads of API-071/072.
dailyStatsSchema.index({ date: 1, staffId: 1 }, { unique: true });

export const DailyStatsModel =
  (mongoose.models.DailyStats as mongoose.Model<DailyStatsDoc> | undefined) ??
  mongoose.model<DailyStatsDoc>('DailyStats', dailyStatsSchema);
