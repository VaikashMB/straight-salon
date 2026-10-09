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

// "HH:mm" (24-hour, as stored) to a 12-hour clock for customers: "09:30" -> "9:30 AM",
// "12:00" -> "12:00 PM", "00:00" -> "12:00 AM".
export function formatClock12(hhmm: string): string {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  const period = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

// Business hours Monday first, as people read a week, in 12-hour time.
export function weekHours(settings: PublicSettings) {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const entry = settings.businessHours.find((h) => h.dayOfWeek === day);
    return {
      day: WEEKDAYS[day]!,
      hours: entry?.isOpen
        ? `${formatClock12(entry.open)} – ${formatClock12(entry.close)}`
        : 'Closed',
    };
  });
}
