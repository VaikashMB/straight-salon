import type { PublicSettings } from './api';

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// Business hours Monday first, as people read a week.
export function weekHours(settings: PublicSettings) {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const entry = settings.businessHours.find((h) => h.dayOfWeek === day);
    return {
      day: WEEKDAYS[day]!,
      hours: entry?.isOpen ? `${entry.open} – ${entry.close}` : 'Closed',
    };
  });
}
