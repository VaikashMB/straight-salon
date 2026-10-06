import type { UserDoc } from './users.model.js';
import type { UserDto } from './users.schemas.js';

// Model -> API DTO: `_id` -> `id`, never passwordHash or internal fields.
export function toUserDto(user: UserDoc): UserDto {
  const dto: UserDto = {
    id: user._id.toHexString(),
    name: user.name,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    isWalkIn: user.isWalkIn,
    preferences: {
      smsOptIn: user.preferences?.smsOptIn ?? true,
      emailOptIn: user.preferences?.emailOptIn ?? true,
    },
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
  if (user.email) dto.email = user.email;
  if (user.preferences?.preferredStaffId)
    dto.preferences.preferredStaffId = user.preferences.preferredStaffId.toHexString();
  if (user.lastLoginAt) dto.lastLoginAt = user.lastLoginAt.toISOString();
  return dto;
}

// Fields recorded in audit rows (07 §2.2): no password hash; the audit service masks email/phone.
export function toAuditView(user: UserDoc): Record<string, unknown> {
  return {
    name: user.name,
    email: user.email ?? null,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    isWalkIn: user.isWalkIn,
    preferences: {
      preferredStaffId: user.preferences?.preferredStaffId?.toHexString() ?? null,
      smsOptIn: user.preferences?.smsOptIn ?? true,
      emailOptIn: user.preferences?.emailOptIn ?? true,
    },
  };
}
