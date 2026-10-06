import mongoose, { type ClientSession, type Types } from 'mongoose';
import {
  PasswordResetTokenModel,
  RefreshTokenModel,
  type PasswordResetTokenDoc,
  type RefreshTokenDoc,
} from './tokens.model.js';

// Operator objects are wrapped in trusted() because sanitizeFilter is on (06 §4).
const NOT_REVOKED = () => mongoose.trusted({ $exists: false });

export interface NewRefreshToken {
  userId: Types.ObjectId;
  tokenHash: string;
  family: string;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}

export interface TokensRepository {
  createRefresh(token: NewRefreshToken, session?: ClientSession): Promise<void>;
  findRefreshByHash(tokenHash: string): Promise<RefreshTokenDoc | null>;
  // Atomically revokes an active token, recording its successor. Null if it was already revoked
  // (e.g. a concurrent refresh), which the caller treats as reuse.
  rotateRefresh(
    tokenHash: string,
    replacedByHash: string,
    now: Date,
  ): Promise<RefreshTokenDoc | null>;
  revokeRefresh(tokenHash: string, now: Date): Promise<RefreshTokenDoc | null>;
  revokeFamily(family: string, now: Date): Promise<number>;
  revokeAllForUser(userId: Types.ObjectId, now: Date, session?: ClientSession): Promise<number>;

  createReset(
    token: Omit<PasswordResetTokenDoc, '_id' | 'usedAt'>,
    session?: ClientSession,
  ): Promise<void>;
  deleteUnusedResets(userId: Types.ObjectId, session?: ClientSession): Promise<void>;
  // Atomically marks an unused, unexpired token as used; null if invalid, used or expired.
  consumeReset(
    tokenHash: string,
    now: Date,
    session?: ClientSession,
  ): Promise<PasswordResetTokenDoc | null>;
}

export const tokensRepository: TokensRepository = {
  async createRefresh(token, session) {
    await RefreshTokenModel.create([token], session ? { session } : {});
  },

  findRefreshByHash: (tokenHash) =>
    RefreshTokenModel.findOne({ tokenHash }).lean<RefreshTokenDoc>(),

  rotateRefresh: (tokenHash, replacedByHash, now) =>
    RefreshTokenModel.findOneAndUpdate(
      { tokenHash, revokedAt: NOT_REVOKED() },
      { $set: { revokedAt: now, replacedByHash } },
      { returnDocument: 'after' },
    ).lean<RefreshTokenDoc>(),

  revokeRefresh: (tokenHash, now) =>
    RefreshTokenModel.findOneAndUpdate(
      { tokenHash, revokedAt: NOT_REVOKED() },
      { $set: { revokedAt: now } },
      { returnDocument: 'after' },
    ).lean<RefreshTokenDoc>(),

  async revokeFamily(family, now) {
    const result = await RefreshTokenModel.updateMany(
      { family, revokedAt: NOT_REVOKED() },
      { $set: { revokedAt: now } },
    );
    return result.modifiedCount;
  },

  async revokeAllForUser(userId, now, session) {
    const result = await RefreshTokenModel.updateMany(
      { userId, revokedAt: NOT_REVOKED() },
      { $set: { revokedAt: now } },
      { session },
    );
    return result.modifiedCount;
  },

  async createReset(token, session) {
    await PasswordResetTokenModel.create([token], session ? { session } : {});
  },

  async deleteUnusedResets(userId, session) {
    await PasswordResetTokenModel.deleteMany(
      { userId, usedAt: mongoose.trusted({ $exists: false }) },
      { session },
    );
  },

  consumeReset: (tokenHash, now, session) =>
    PasswordResetTokenModel.findOneAndUpdate(
      {
        tokenHash,
        usedAt: mongoose.trusted({ $exists: false }),
        expiresAt: mongoose.trusted({ $gt: now }),
      },
      { $set: { usedAt: now } },
      { returnDocument: 'after', session },
    ).lean<PasswordResetTokenDoc>(),
};
