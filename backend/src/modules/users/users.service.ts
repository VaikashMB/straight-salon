import { Types, type ClientSession, type Connection } from 'mongoose';
import type { Role } from '../../config/constants.js';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { AuthContext } from '../../shared/auth/accessToken.js';
import type { PasswordHasher } from '../../shared/auth/password.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import { paginated, parseSort, skipFor, type Paginated } from '../../shared/http/pagination.js';
import { toAuditView, toUserDto } from './users.mapper.js';
import type { UserDoc } from './users.model.js';
import type { NewUser, UserChanges, UsersRepository } from './users.repository.js';
import type {
  AdminUpdateBody,
  CreateUserBody,
  ListUsersQuery,
  UpdateMeBody,
  UserDto,
  WalkInBody,
} from './users.schemas.js';

// Users module public interface (01 §3: other modules use this service, never the repository).

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface UsersService {
  // Used by auth (06)
  registerCustomer(input: RegisterInput): Promise<UserDoc>;
  findForLogin(email: string): Promise<UserDoc | null>;
  findWithPassword(id: string): Promise<UserDoc | null>;
  findActiveById(id: string): Promise<UserDoc | null>;
  recordLogin(id: Types.ObjectId, at: Date): Promise<void>;
  setPassword(
    id: Types.ObjectId,
    passwordHash: string,
    changedAt: Date,
    session: ClientSession,
  ): Promise<void>;
  // API-009..015
  getMe(userId: string): Promise<UserDto>;
  updateMe(userId: string, body: UpdateMeBody): Promise<UserDto>;
  list(query: ListUsersQuery, viewer: AuthContext): Promise<Paginated<UserDto>>;
  createAccount(body: CreateUserBody): Promise<UserDto>;
  findOrCreateWalkIn(body: WalkInBody): Promise<{ user: UserDto; created: boolean }>;
  getForStaff(id: string, viewer: AuthContext): Promise<UserDto>;
  adminUpdate(id: string, body: AdminUpdateBody, actor: AuthContext): Promise<UserDto>;
  // For bookings
  findByIds(ids: string[]): Promise<UserDoc[]>;
  idsByPhonePrefix(prefix: string): Promise<string[]>;
}

export interface UsersServiceDeps {
  repository: UsersRepository;
  audit: AuditService;
  outbox: Outbox;
  hasher: PasswordHasher;
  connection: Connection;
}

const SORTABLE = ['name', 'createdAt', 'lastLoginAt'] as const;

export function createUsersService(deps: UsersServiceDeps): UsersService {
  const { repository, audit, outbox, hasher, connection } = deps;

  async function assertEmailFree(email: string): Promise<void> {
    if (await repository.findByEmail(email)) {
      throw new ConflictError('An account with this email already exists.');
    }
  }

  // FR-001: a phone held by a walk-in record gets its own code, so the UI can explain it.
  async function assertPhoneFree(phone: string, exceptId?: Types.ObjectId): Promise<void> {
    const existing = await repository.findByPhone(phone);
    if (!existing || (exceptId && existing._id.equals(exceptId))) return;
    if (existing.isWalkIn) {
      throw new ConflictError(
        'This phone number belongs to a walk-in customer record. Please contact the front desk to link it.',
        'PHONE_ALREADY_REGISTERED',
      );
    }
    throw new ConflictError('An account with this phone number already exists.');
  }

  // selfRegistration: the new user is their own actor (no one is logged in yet) and EVT-001 is
  // emitted. Otherwise the actor is the logged-in admin/receptionist from the request context.
  async function createAudited(
    user: NewUser,
    {
      selfRegistration,
      metadata,
    }: { selfRegistration: boolean; metadata?: Record<string, unknown> },
  ): Promise<UserDoc> {
    return withTransaction(connection, async (session) => {
      const created = await repository.create(user, session);
      await audit.record(
        {
          action: 'user.create',
          entityType: 'user',
          entityId: created._id.toHexString(),
          before: null,
          after: toAuditView(created),
          ...(metadata ? { metadata } : {}),
          ...(selfRegistration
            ? { actor: { id: created._id.toHexString(), role: created.role } }
            : {}),
        },
        session,
      );
      if (selfRegistration) {
        // EVT-001 (welcome email, 09 §5)
        await outbox.add(session, {
          type: 'user.registered',
          aggregateType: 'user',
          aggregateId: created._id.toHexString(),
          payload: { userId: created._id.toHexString() },
          actor: { id: created._id.toHexString(), role: created.role },
        });
      }
      return created;
    });
  }

  async function requireUser(id: string): Promise<UserDoc> {
    const user = Types.ObjectId.isValid(id) ? await repository.findById(id) : null;
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }

  return {
    async registerCustomer(input) {
      await assertEmailFree(input.email);
      await assertPhoneFree(input.phone);
      const passwordHash = await hasher.hash(input.password);
      return createAudited(
        {
          name: input.name,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: 'CUSTOMER',
          isWalkIn: false,
        },
        { selfRegistration: true },
      );
    },

    findForLogin: (email) => repository.findByEmailWithPassword(email),
    findWithPassword: (id) => repository.findByIdWithPassword(id),
    async findActiveById(id) {
      const user = await repository.findById(id);
      return user?.isActive ? user : null;
    },
    recordLogin: (id, at) => repository.setLastLogin(id, at),
    setPassword: (id, passwordHash, changedAt, session) =>
      repository.setPassword(id, passwordHash, changedAt, session),

    async getMe(userId) {
      return toUserDto(await requireUser(userId));
    },

    async updateMe(userId, body) {
      const user = await requireUser(userId);
      if (body.phone && body.phone !== user.phone) await assertPhoneFree(body.phone, user._id);

      const changes: UserChanges = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.phone !== undefined) changes.phone = body.phone;
      if (body.preferences) {
        const current = user.preferences ?? { smsOptIn: true, emailOptIn: true };
        const preferredStaffId =
          body.preferences.preferredStaffId === undefined
            ? current.preferredStaffId
            : body.preferences.preferredStaffId === null
              ? undefined
              : new Types.ObjectId(body.preferences.preferredStaffId);
        changes.preferences = {
          smsOptIn: body.preferences.smsOptIn ?? current.smsOptIn,
          emailOptIn: body.preferences.emailOptIn ?? current.emailOptIn,
          ...(preferredStaffId ? { preferredStaffId } : {}),
        };
      }

      const updated = await withTransaction(connection, async (session) => {
        const next = await repository.update(user._id, changes, session);
        if (!next) throw new NotFoundError('User not found.');
        await audit.record(
          {
            action: 'user.update',
            entityType: 'user',
            entityId: userId,
            before: toAuditView(user),
            after: toAuditView(next),
          },
          session,
        );
        return next;
      });
      return toUserDto(updated);
    },

    async list(query, viewer) {
      // Receptionists see customers only (04 API-011, 06 §3 users:read).
      const role: Role | undefined = viewer.role === 'RECEPTIONIST' ? 'CUSTOMER' : query.role;
      const result = await repository.search({
        ...(query.q ? { q: query.q } : {}),
        ...(role ? { role } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        skip: skipFor(query),
        limit: query.pageSize,
        sort: parseSort(query.sort, SORTABLE, { createdAt: -1 }),
      });
      return paginated(result.data.map(toUserDto), result.total, query);
    },

    async createAccount(body) {
      await assertEmailFree(body.email);
      await assertPhoneFree(body.phone);
      const passwordHash = await hasher.hash(body.password);
      const created = await createAudited(
        {
          name: body.name,
          email: body.email,
          phone: body.phone,
          passwordHash,
          role: body.role,
          isWalkIn: false,
        },
        { selfRegistration: false },
      );
      return toUserDto(created);
    },

    async findOrCreateWalkIn(body) {
      const existing = await repository.findByPhone(body.phone);
      if (existing) {
        if (existing.role !== 'CUSTOMER') {
          throw new ConflictError('This phone number belongs to a staff account.');
        }
        return { user: toUserDto(existing), created: false };
      }
      const created = await createAudited(
        { name: body.name, phone: body.phone, role: 'CUSTOMER', isWalkIn: true },
        { selfRegistration: false, metadata: { walkIn: true } },
      );
      return { user: toUserDto(created), created: true };
    },

    async getForStaff(id, viewer) {
      const user = await requireUser(id);
      // Receptionists may only see customers; anything else looks like "not found" (06 §3).
      if (viewer.role === 'RECEPTIONIST' && user.role !== 'CUSTOMER')
        throw new NotFoundError('User not found.');
      return toUserDto(user);
    },

    async adminUpdate(id, body, actor) {
      if (id === actor.userId) {
        throw new ForbiddenError('You cannot change your own role or active status.');
      }
      const user = await requireUser(id);
      const changes: UserChanges = {};
      if (body.role !== undefined && body.role !== user.role) changes.role = body.role;
      if (body.isActive !== undefined && body.isActive !== user.isActive)
        changes.isActive = body.isActive;
      if (Object.keys(changes).length === 0) return toUserDto(user);

      // Sessions of a deactivated user end at their next refresh (06 §2 step 5); a role change
      // reaches the access token at the next refresh too (<= JWT_ACCESS_TTL).
      const updated = await withTransaction(connection, async (session) => {
        const next = await repository.update(user._id, changes, session);
        if (!next) throw new NotFoundError('User not found.');
        if (changes.role !== undefined) {
          await audit.record(
            {
              action: 'user.role_change',
              entityType: 'user',
              entityId: id,
              before: { role: user.role },
              after: { role: next.role },
            },
            session,
          );
        }
        if (changes.isActive !== undefined) {
          await audit.record(
            {
              action: changes.isActive ? 'user.update' : 'user.deactivate',
              entityType: 'user',
              entityId: id,
              before: { isActive: user.isActive },
              after: { isActive: next.isActive },
            },
            session,
          );
        }
        return next;
      });
      return toUserDto(updated);
    },

    async findByIds(ids) {
      const valid = ids.filter((id) => Types.ObjectId.isValid(id));
      return valid.length === 0 ? [] : repository.findByIds(valid);
    },

    async idsByPhonePrefix(prefix) {
      const { data } = await repository.search({
        q: prefix,
        skip: 0,
        limit: 50,
        sort: { createdAt: -1 },
      });
      return data.map((u) => u._id.toHexString());
    },
  };
}
