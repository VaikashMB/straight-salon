import mongoose, { Types, type ClientSession } from 'mongoose';
import type { DayStatsRow } from './dailyStats.js';
import { DailyStatsModel, type DailyStatsDoc } from './reports.model.js';

// All Mongoose access for daily_stats.

export interface ReportsRepository {
  // Replaces every row of `date` (inside the recompute transaction).
  replaceDay(date: string, rows: DayStatsRow[], session: ClientSession): Promise<void>;
  // Rows with from <= date <= to, by date ({ date, staffId } index).
  findRange(from: string, to: string): Promise<DailyStatsDoc[]>;
}

export const reportsRepository: ReportsRepository = {
  async replaceDay(date, rows, session) {
    await DailyStatsModel.deleteMany({ date }, { session });
    await DailyStatsModel.insertMany(
      rows.map((row) => ({
        ...row,
        date,
        staffId: row.staffId ? new Types.ObjectId(row.staffId) : null,
        byService: row.byService.map((s) => ({ ...s, serviceId: new Types.ObjectId(s.serviceId) })),
      })),
      { session },
    );
  },

  findRange: (from, to) =>
    DailyStatsModel.find({ date: mongoose.trusted({ $gte: from, $lte: to }) })
      .sort({ date: 1, staffId: 1 })
      .lean<DailyStatsDoc[]>(),
};
