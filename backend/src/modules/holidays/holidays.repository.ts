import mongoose, { type ClientSession, type QueryFilter, type Types } from 'mongoose';
import { HolidayModel, type HolidayDoc } from './holidays.model.js';

export interface HolidaysRepository {
  list(range: { from?: string; to?: string }): Promise<HolidayDoc[]>;
  findById(id: string): Promise<HolidayDoc | null>;
  findByDate(date: string): Promise<HolidayDoc | null>;
  create(holiday: { date: string; name: string }, session?: ClientSession): Promise<HolidayDoc>;
  delete(id: Types.ObjectId, session?: ClientSession): Promise<boolean>;
}

export const holidaysRepository: HolidaysRepository = {
  list({ from, to }) {
    const filter: QueryFilter<HolidayDoc> = {};
    // "YYYY-MM-DD" strings sort chronologically; backed by the unique { date } index.
    if (from || to) {
      filter.date = mongoose.trusted({
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      });
    }
    return HolidayModel.find(filter).sort({ date: 1 }).lean<HolidayDoc[]>();
  },
  findById: (id) => HolidayModel.findById(id).lean<HolidayDoc>(),
  findByDate: (date) => HolidayModel.findOne({ date }).lean<HolidayDoc>(),
  async create(holiday, session) {
    const [created] = await HolidayModel.create([holiday], { session });
    return created!.toObject();
  },
  async delete(id, session) {
    const result = await HolidayModel.deleteOne({ _id: id }, { session });
    return result.deletedCount === 1;
  },
};
