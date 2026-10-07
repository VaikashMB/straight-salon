import mongoose, { Schema, type Types } from 'mongoose';
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  PAYMENT_METHODS,
  type BookingSource,
  type BookingStatus,
  type PaymentMethod,
} from '../../config/constants.js';

// bookings (02-database §2.11)

export interface BookedService {
  serviceId: Types.ObjectId;
  name: string;
  durationMin: number;
  priceMinor: number; // price snapshot at booking time (FR-032)
}

export interface StatusChange {
  status: BookingStatus;
  at: Date;
  by: string; // userId, or "system"
  note?: string;
}

export interface Cancellation {
  at: Date;
  by: string;
  reason?: string;
  overridden: boolean;
}

export interface Payment {
  status: 'UNPAID' | 'PAID';
  method?: PaymentMethod;
  amountPaidMinor?: number;
  discountMinor?: number;
  discountReason?: string;
  recordedBy?: Types.ObjectId;
  recordedAt?: Date;
}

export interface BookingDoc {
  _id: Types.ObjectId;
  bookingRef: string;
  customerId: Types.ObjectId;
  staffId: Types.ObjectId;
  services: BookedService[];
  startAt: Date;
  endAt: Date; // startAt + total duration
  blockedUntil: Date; // endAt + bufferMin; used for overlap checks (BR-004)
  totalDurationMin: number;
  totalPriceMinor: number;
  status: BookingStatus;
  statusHistory: StatusChange[];
  source: BookingSource;
  notes?: string;
  cancellation?: Cancellation;
  payment: Payment;
  // Absent until a reminder is queued: Mongoose drops the empty object (minimize).
  reminders?: { h24SentAt?: Date; h2SentAt?: Date };
  createdBy: Types.ObjectId;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<BookingDoc>(
  {
    bookingRef: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true },
    staffId: { type: Schema.Types.ObjectId, required: true },
    services: {
      type: [
        new Schema<BookedService>(
          {
            serviceId: { type: Schema.Types.ObjectId, required: true },
            name: { type: String, required: true },
            durationMin: { type: Number, required: true },
            priceMinor: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    blockedUntil: { type: Date, required: true },
    totalDurationMin: { type: Number, required: true },
    totalPriceMinor: { type: Number, required: true },
    status: { type: String, enum: BOOKING_STATUSES, required: true },
    statusHistory: {
      type: [
        new Schema<StatusChange>(
          {
            status: { type: String, enum: BOOKING_STATUSES, required: true },
            at: { type: Date, required: true },
            by: { type: String, required: true },
            note: String,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    source: { type: String, enum: BOOKING_SOURCES, required: true },
    notes: { type: String, maxlength: 300 },
    cancellation: {
      type: new Schema<Cancellation>(
        {
          at: { type: Date, required: true },
          by: { type: String, required: true },
          reason: String,
          overridden: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    payment: {
      status: { type: String, enum: ['UNPAID', 'PAID'], required: true, default: 'UNPAID' },
      method: { type: String, enum: PAYMENT_METHODS },
      amountPaidMinor: Number,
      discountMinor: Number,
      discountReason: String,
      recordedBy: Schema.Types.ObjectId,
      recordedAt: Date,
    },
    reminders: { h24SentAt: Date, h2SentAt: Date },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'bookings', timestamps: true, optimisticConcurrency: true },
);

bookingSchema.index({ bookingRef: 1 }, { unique: true });
bookingSchema.index({ staffId: 1, startAt: 1 }); // availability & overlap checks
bookingSchema.index({ customerId: 1, startAt: -1 }); // "my bookings"
bookingSchema.index({ status: 1, startAt: 1 }); // no-show job, reminders, dashboard
bookingSchema.index({ startAt: 1 }); // reports, staff list by date

export const BookingModel =
  (mongoose.models.Booking as mongoose.Model<BookingDoc> | undefined) ??
  mongoose.model<BookingDoc>('Booking', bookingSchema);
