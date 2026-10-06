import mongoose, { type ClientSession, type QueryFilter, type Types } from 'mongoose';
import type { Role } from '../../config/constants.js';
import { UserModel, type UserDoc, type UserPreferences } from './users.model.js';

// All Mongoose access for users. Operator objects written here are wrapped in trusted()
// because sanitizeFilter is on (06 §4); user input is never wrapped.

export interface NewUser {
  name: string;
  email?: string;
  phone: string;
  passwordHash?: string;
  role: Role;
  isWalkIn: boolean;
  preferences?: Partial<UserPreferences>;
}

export interface UserSearch {
  q?: string;
  role?: Role;
  isActive?: boolean;
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

export interface UserChanges {
  name?: string;
  phone?: string;
  role?: Role;
  isActive?: boolean;
  preferences?: UserPreferences;
}

export interface UsersRepository {
  create(user: NewUser, session?: ClientSession): Promise<UserDoc>;
  findById(id: string | Types.ObjectId): Promise<UserDoc | null>;
  findByEmailWithPassword(email: string): Promise<UserDoc | null>;
  findByIdWithPassword(id: string | Types.ObjectId): Promise<UserDoc | null>;
  findByEmail(email: string): Promise<UserDoc | null>;
  findByPhone(phone: string): Promise<UserDoc | null>;
  update(
    id: Types.ObjectId,
    changes: UserChanges,
    session?: ClientSession,
  ): Promise<UserDoc | null>;
  setPassword(
    id: Types.ObjectId,
    passwordHash: string,
    changedAt: Date,
    session?: ClientSession,
  ): Promise<void>;
  setLastLogin(id: Types.ObjectId, at: Date): Promise<void>;
  search(search: UserSearch): Promise<{ data: UserDoc[]; total: number }>;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// q: phone digits -> phone prefix; contains "@" -> email prefix; otherwise name text search.
// Each branch is backed by an index from 02 §2.1.
export function searchFilter({
  q,
  role,
  isActive,
}: Pick<UserSearch, 'q' | 'role' | 'isActive'>): QueryFilter<UserDoc> {
  const filter: QueryFilter<UserDoc> = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive;
  const term = q?.trim();
  if (term) {
    if (/^\+?\d{3,}$/.test(term)) {
      const digits = term.startsWith('+') ? term : `+${term}`;
      filter.phone = mongoose.trusted({ $regex: `^${escapeRegex(digits)}` });
    } else if (term.includes('@')) {
      filter.email = mongoose.trusted({ $regex: `^${escapeRegex(term.toLowerCase())}` });
    } else {
      Object.assign(filter, { $text: mongoose.trusted({ $search: term }) });
    }
  }
  return filter;
}

export const usersRepository: UsersRepository = {
  async create(user, session) {
    const [created] = await UserModel.create([user], session ? { session } : {});
    return created!.toObject();
  },
  findById: (id) => UserModel.findById(id).lean<UserDoc>(),
  findByEmailWithPassword: (email) =>
    UserModel.findOne({ email }).select('+passwordHash').lean<UserDoc>(),
  findByIdWithPassword: (id) => UserModel.findById(id).select('+passwordHash').lean<UserDoc>(),
  findByEmail: (email) => UserModel.findOne({ email }).lean<UserDoc>(),
  findByPhone: (phone) => UserModel.findOne({ phone }).lean<UserDoc>(),

  update: (id, changes, session) =>
    UserModel.findByIdAndUpdate(
      id,
      { $set: changes },
      { returnDocument: 'after', runValidators: true, session },
    ).lean<UserDoc>(),

  async setPassword(id, passwordHash, changedAt, session) {
    await UserModel.updateOne(
      { _id: id },
      { $set: { passwordHash, passwordChangedAt: changedAt } },
      { session },
    );
  },

  async setLastLogin(id, at) {
    await UserModel.updateOne({ _id: id }, { $set: { lastLoginAt: at } });
  },

  async search(search) {
    const filter = searchFilter(search);
    const [data, total] = await Promise.all([
      UserModel.find(filter)
        .sort(search.sort)
        .skip(search.skip)
        .limit(search.limit)
        .lean<UserDoc[]>(),
      UserModel.countDocuments(filter),
    ]);
    return { data, total };
  },
};
