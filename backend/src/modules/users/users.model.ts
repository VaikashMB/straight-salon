import mongoose, { Schema, type Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants.js';

// users (02-database §2.1)
export interface UserPreferences {
  preferredStaffId?: Types.ObjectId;
  smsOptIn: boolean;
  emailOptIn: boolean;
}

export interface UserDoc {
  _id: Types.ObjectId;
  name: string;
  email?: string; // omitted (never null) for walk-ins: the unique index is sparse (02 §1)
  phone: string;
  passwordHash?: string; // select: false; absent for walk-ins
  role: Role;
  isActive: boolean;
  isWalkIn: boolean;
  preferences: UserPreferences;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, required: true, default: true },
    isWalkIn: { type: Boolean, required: true, default: false },
    preferences: {
      preferredStaffId: { type: Schema.Types.ObjectId },
      smsOptIn: { type: Boolean, default: true },
      emailOptIn: { type: Boolean, default: true },
    },
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  { collection: 'users', timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ name: 'text' });

export const UserModel =
  (mongoose.models.User as mongoose.Model<UserDoc> | undefined) ??
  mongoose.model<UserDoc>('User', userSchema);
