import mongoose, { Schema, type ClientSession, type Types } from 'mongoose';

// BR-004 concurrency guard (02-database §2.18). Snapshot isolation lets two transactions both
// read "no overlap" and insert different bookings (write skew). Making every transaction that
// adds or moves an active booking (or adds time-off) also write the same guard document turns
// that race into a write conflict: one transaction is retried and then sees the other's booking.

export interface StaffDayKey {
  staffId: string | Types.ObjectId;
  date: string; // YYYY-MM-DD in salon timezone
}

interface StaffDayGuardDoc {
  staffId: Types.ObjectId;
  date: string;
  seq: number;
}

const staffDayGuardSchema = new Schema<StaffDayGuardDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: 'staff_day_guards', versionKey: false, timestamps: true },
);
staffDayGuardSchema.index({ staffId: 1, date: 1 }, { unique: true });

export const StaffDayGuardModel =
  (mongoose.models.StaffDayGuard as mongoose.Model<StaffDayGuardDoc> | undefined) ??
  mongoose.model<StaffDayGuardDoc>('StaffDayGuard', staffDayGuardSchema);

const TRANSIENT = 'TransientTransactionError';

interface LabelledError {
  code?: unknown;
  addErrorLabel?: (label: string) => void;
}

// Bumps the guard for each stylist/day, in a stable order. Call it inside the transaction
// BEFORE the overlap query. Two transactions racing to *create* the same guard row get a
// duplicate-key error instead of a write conflict; it is labelled transient so withTransaction
// retries it like a write conflict (02 §2.18).
export async function bumpStaffDayGuards(
  session: ClientSession,
  keys: StaffDayKey[],
): Promise<void> {
  const unique = new Map(keys.map((k) => [`${String(k.staffId)}|${k.date}`, k]));
  const ordered = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, k]) => k);
  for (const key of ordered) {
    try {
      await StaffDayGuardModel.updateOne(
        { staffId: key.staffId, date: key.date },
        { $inc: { seq: 1 } },
        { upsert: true, session },
      );
    } catch (err) {
      const labelled = err as LabelledError;
      if (labelled.code === 11000 && typeof labelled.addErrorLabel === 'function') {
        labelled.addErrorLabel(TRANSIENT);
      }
      throw err;
    }
  }
}
