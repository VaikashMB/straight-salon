import mongoose, { Schema, type Types } from 'mongoose';

// reviews (02-database §2.12): one per completed booking (BR-012).

export interface ReviewDoc {
  _id: Types.ObjectId;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  staffId: Types.ObjectId;
  serviceIds: Types.ObjectId[];
  rating: number; // 1-5
  comment?: string;
  isHidden: boolean;
  hiddenBy?: Types.ObjectId;
  hiddenReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<ReviewDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true },
    staffId: { type: Schema.Types.ObjectId, required: true },
    serviceIds: { type: [Schema.Types.ObjectId], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
    isHidden: { type: Boolean, required: true, default: false },
    hiddenBy: Schema.Types.ObjectId,
    hiddenReason: { type: String, maxlength: 200 },
  },
  { collection: 'reviews', timestamps: true },
);

reviewSchema.index({ bookingId: 1 }, { unique: true });
reviewSchema.index({ staffId: 1, isHidden: 1, createdAt: -1 }); // API-061 by stylist, ratings
reviewSchema.index({ serviceIds: 1, isHidden: 1, createdAt: -1 }); // API-061 by service, ratings
reviewSchema.index({ isHidden: 1, createdAt: -1 }); // API-061 unfiltered

export const ReviewModel =
  (mongoose.models.Review as mongoose.Model<ReviewDoc> | undefined) ??
  mongoose.model<ReviewDoc>('Review', reviewSchema);
