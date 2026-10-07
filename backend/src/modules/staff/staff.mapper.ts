import type { StylistSummaryDto } from '../catalog/catalog.schemas.js';
import type { SettingsDto } from '../settings/settings.schemas.js';
import type { ScheduleDay, StaffDoc, StaffScheduleDoc, TimeOffDoc } from './staff.model.js';
import type { ScheduleDto, StaffDto, TimeOffDto } from './staff.schemas.js';

// Public fields only unless `admin` (04 API-030: "public fields only").
export function toStaffDto(staff: StaffDoc, { admin = false } = {}): StaffDto {
  const dto: StaffDto = {
    id: staff._id.toHexString(),
    displayName: staff.displayName,
    serviceIds: staff.serviceIds.map((id) => id.toHexString()),
    ratingAvg: staff.ratingAvg,
    ratingCount: staff.ratingCount,
  };
  if (staff.bio) dto.bio = staff.bio;
  if (staff.photoUrl) dto.photoUrl = staff.photoUrl;
  if (admin) {
    dto.userId = staff.userId.toHexString();
    dto.isActive = staff.isActive;
  }
  return dto;
}

export function toStylistSummary(staff: StaffDoc): StylistSummaryDto {
  const dto: StylistSummaryDto = {
    id: staff._id.toHexString(),
    displayName: staff.displayName,
    ratingAvg: staff.ratingAvg,
    ratingCount: staff.ratingCount,
  };
  if (staff.photoUrl) dto.photoUrl = staff.photoUrl;
  return dto;
}

// Plain days in a fixed shape, sorted by weekday.
export function normaliseWeekly(weekly: ScheduleDay[]): ScheduleDay[] {
  return [...weekly]
    .map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isWorking: day.isWorking,
      start: day.start,
      end: day.end,
      breaks: [...day.breaks]
        .map((b) => ({ start: b.start, end: b.end }))
        .sort((a, b) => a.start.localeCompare(b.start)),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

// FR-023: a stylist's schedule defaults to the salon's business hours.
export function defaultWeekly(settings: Pick<SettingsDto, 'businessHours'>): ScheduleDay[] {
  return normaliseWeekly(
    settings.businessHours.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isWorking: day.isOpen,
      start: day.open,
      end: day.close,
      breaks: [],
    })),
  );
}

export function toScheduleDto(
  staffId: string,
  schedule: Pick<StaffScheduleDoc, 'weekly'>,
): ScheduleDto {
  return { staffId, weekly: normaliseWeekly(schedule.weekly) };
}

export function toTimeOffDto(timeOff: TimeOffDoc): TimeOffDto {
  const dto: TimeOffDto = {
    id: timeOff._id.toHexString(),
    staffId: timeOff.staffId.toHexString(),
    startAt: timeOff.startAt.toISOString(),
    endAt: timeOff.endAt.toISOString(),
    createdBy: timeOff.createdBy.toHexString(),
    createdAt: timeOff.createdAt.toISOString(),
  };
  if (timeOff.reason) dto.reason = timeOff.reason;
  return dto;
}

export const staffAuditView = (s: StaffDoc): Record<string, unknown> => ({
  userId: s.userId.toHexString(),
  displayName: s.displayName,
  bio: s.bio ?? null,
  photoUrl: s.photoUrl ?? null,
  serviceIds: s.serviceIds.map((id) => id.toHexString()),
  isActive: s.isActive,
});

export const timeOffAuditView = (t: TimeOffDoc): Record<string, unknown> => ({
  timeOff: {
    id: t._id.toHexString(),
    startAt: t.startAt.toISOString(),
    endAt: t.endAt.toISOString(),
    reason: t.reason ?? null,
  },
});
