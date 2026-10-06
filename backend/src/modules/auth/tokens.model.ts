import mongoose, { Schema, type Types } from 'mongoose';

// refresh_tokens (02 §2.2) and password_reset_tokens (02 §2.3). Only SHA-256 hashes are stored.

export interface RefreshTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  family: string; // UUID shared by every rotation of one login (reuse detection)
  expiresAt: Date;
  revokedAt?: Date;
  replacedByHash?: string;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedByHash: String,
    userAgent: { type: String, maxlength: 512 },
    ip: String,
  },
  { collection: 'refresh_tokens', timestamps: true },
);
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ family: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel =
  (mongoose.models.RefreshToken as mongoose.Model<RefreshTokenDoc> | undefined) ??
  mongoose.model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);

export interface PasswordResetTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
}

const passwordResetTokenSchema = new Schema<PasswordResetTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { collection: 'password_reset_tokens', timestamps: true },
);
passwordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetTokenSchema.index({ userId: 1 });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetTokenModel =
  (mongoose.models.PasswordResetToken as mongoose.Model<PasswordResetTokenDoc> | undefined) ??
  mongoose.model<PasswordResetTokenDoc>('PasswordResetToken', passwordResetTokenSchema);
