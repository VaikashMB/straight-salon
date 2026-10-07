import mongoose, { Types, type ClientSession, type QueryFilter } from 'mongoose';
import { ConflictError } from '../../shared/errors/index.js';
import {
  StaffModel,
  StaffScheduleModel,
  TimeOffModel,
  type ScheduleDay,
  type StaffDoc,
  type StaffScheduleDoc,
  type TimeOffDoc,
} from './staff.model.js';

// All Mongoose access for staff profiles, schedules and time-off. Operator objects written
// here are wrapped in trusted() because sanitizeFilter is on (06 §4).

export interface NewStaff {
  userId: Types.ObjectId;
  displayName: string;
  bio?: string;
  photoUrl?: string;
  serviceIds: Types.ObjectId[];
}

export interface StaffChanges {
  displayName?: string;
  bio?: string | null; // null clears it
  photoUrl?: string | null;
  serviceIds?: Types.ObjectId[];
  isActive?: boolean;
}

export interface NewTimeOff {
  staffId: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  reason?: string;
  createdBy: Types.ObjectId;
}

export interface StaffRepository {
  list(filter: { serviceId?: string; includeInactive: boolean }): Promise<StaffDoc[]>;
  findById(id: string | Types.ObjectId): Promise<StaffDoc | null>;
  findByUserId(userId: string | Types.ObjectId): Promise<StaffDoc | null>;
  create(staff: NewStaff, session?: ClientSession): Promise<StaffDoc>;
  // Optimistic concurrency (02 §1): 409 STALE_VERSION if the profile changed since it was read.
  update(
    id: Types.ObjectId,
    expectedVersion: number,
    changes: StaffChanges,
    session?: ClientSession,
  ): Promise<StaffDoc>;

  findSchedule(staffId: Types.ObjectId): Promise<StaffScheduleDoc | null>;
  saveSchedule(
    staffId: Types.ObjectId,
    weekly: ScheduleDay[],
    session?: ClientSession,
  ): Promise<StaffScheduleDoc>;

  // Time-off overlapping [from, to); either bound may be open.
  listTimeOff(staffId: Types.ObjectId, range: { from?: Date; to?: Date }): Promise<TimeOffDoc[]>;
  findTimeOff(id: string | Types.ObjectId): Promise<TimeOffDoc | null>;
  createTimeOff(timeOff: NewTimeOff, session?: ClientSession): Promise<TimeOffDoc>;
  deleteTimeOff(id: Types.ObjectId, session?: ClientSession): Promise<boolean>;
}

function toUpdate(changes: StaffChanges): {
  $set: Record<string, unknown>;
  $unset: Record<string, 1>;
} {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) $unset[key] = 1;
    else if (value !== undefined) $set[key] = value;
  }
  return { $set, $unset };
}

export const staffRepository: StaffRepository = {
  list({ serviceId, includeInactive }) {
    const filter: QueryFilter<StaffDoc> = {};
    if (!includeInactive) filter.isActive = true;
    if (serviceId) filter.serviceIds = new Types.ObjectId(serviceId);
    return StaffModel.find(filter).sort({ displayName: 1 }).lean<StaffDoc[]>();
  },
  findById: (id) => StaffModel.findById(id).lean<StaffDoc>(),
  findByUserId: (userId) =>
    StaffModel.findOne({ userId: new Types.ObjectId(userId) }).lean<StaffDoc>(),
  async create(staff, session) {
    const [created] = await StaffModel.create([staff], { session });
    return created!.toObject();
  },
  async update(id, expectedVersion, changes, session) {
    const { $set, $unset } = toUpdate(changes);
    const updated = await StaffModel.findOneAndUpdate(
      { _id: id, __v: expectedVersion },
      { $set, $unset, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true, session },
    ).lean<StaffDoc>();
    if (!updated) {
      throw new ConflictError(
        'The stylist was changed by someone else. Reload and try again.',
        'STALE_VERSION',
      );
    }
    return updated;
  },

  findSchedule: (staffId) => StaffScheduleModel.findOne({ staffId }).lean<StaffScheduleDoc>(),
  async saveSchedule(staffId, weekly, session) {
    const saved = await StaffScheduleModel.findOneAndUpdate(
      { staffId },
      { $set: { weekly } },
      { upsert: true, returnDocument: 'after', runValidators: true, session },
    ).lean<StaffScheduleDoc>();
    if (!saved) throw new Error('Schedule upsert returned no document');
    return saved;
  },

  listTimeOff(staffId, { from, to }) {
    const filter: QueryFilter<TimeOffDoc> = { staffId };
    if (to) filter.startAt = mongoose.trusted({ $lt: to });
    if (from) filter.endAt = mongoose.trusted({ $gt: from });
    return TimeOffModel.find(filter).sort({ startAt: 1 }).lean<TimeOffDoc[]>();
  },
  findTimeOff: (id) => TimeOffModel.findById(id).lean<TimeOffDoc>(),
  async createTimeOff(timeOff, session) {
    const [created] = await TimeOffModel.create([timeOff], { session });
    return created!.toObject();
  },
  async deleteTimeOff(id, session) {
    return (await TimeOffModel.deleteOne({ _id: id }, { session })).deletedCount === 1;
  },
};
