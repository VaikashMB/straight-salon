import type { BusinessHours, SettingsDoc, SettingsFields } from './settings.model.js';
import type { PublicSettingsDto, SettingsDto, UpdateSettingsBody } from './settings.schemas.js';

const hours = (h: BusinessHours): BusinessHours => ({
  dayOfWeek: h.dayOfWeek,
  isOpen: h.isOpen,
  open: h.open,
  close: h.close,
});

// Plain fields in a fixed shape and order, so two copies compare equal field by field.
export function toFields(source: SettingsFields): SettingsFields {
  const fields: SettingsFields = {
    name: source.name,
    timezone: source.timezone,
    currency: source.currency,
    businessHours: [...source.businessHours].map(hours).sort((a, b) => a.dayOfWeek - b.dayOfWeek),
    slotGranularityMin: source.slotGranularityMin,
    bufferMin: source.bufferMin,
    minLeadTimeMin: source.minLeadTimeMin,
    maxAdvanceDays: source.maxAdvanceDays,
    cancellationCutoffMin: source.cancellationCutoffMin,
    noShowGraceMin: source.noShowGraceMin,
    reviewWindowDays: source.reviewWindowDays,
  };
  if (source.address) fields.address = source.address;
  if (source.phone) fields.phone = source.phone;
  if (source.email) fields.email = source.email;
  return fields;
}

export const fieldsFromBody = (body: UpdateSettingsBody): SettingsFields => toFields(body);

export function toSettingsDto(source: SettingsFields | SettingsDoc): SettingsDto {
  const dto: SettingsDto = toFields(source);
  if ('updatedAt' in source) dto.updatedAt = source.updatedAt.toISOString();
  return dto;
}

export function toPublicSettingsDto(settings: SettingsDto): PublicSettingsDto {
  const dto: PublicSettingsDto = {
    name: settings.name,
    timezone: settings.timezone,
    currency: settings.currency,
    businessHours: settings.businessHours,
    slotGranularityMin: settings.slotGranularityMin,
    minLeadTimeMin: settings.minLeadTimeMin,
    maxAdvanceDays: settings.maxAdvanceDays,
    cancellationCutoffMin: settings.cancellationCutoffMin,
  };
  if (settings.address) dto.address = settings.address;
  if (settings.phone) dto.phone = settings.phone;
  if (settings.email) dto.email = settings.email;
  return dto;
}

// Top-level keys whose values differ (EVT-032 payload).
export function changedKeys(before: SettingsFields, after: SettingsFields): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<
    keyof SettingsFields
  >;
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
