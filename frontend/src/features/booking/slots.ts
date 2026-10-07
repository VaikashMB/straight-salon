import { minutesInZone } from '@/lib/time';

// Time-slot chips grouped by part of day in the salon timezone (05 §4.1).

export type DayPart = 'Morning' | 'Afternoon' | 'Evening';

const NOON = 12 * 60;
const EVENING = 17 * 60;

export function dayPart(startAt: string, timeZone: string): DayPart {
  const minutes = minutesInZone(startAt, timeZone);
  if (minutes < NOON) return 'Morning';
  return minutes < EVENING ? 'Afternoon' : 'Evening';
}

export function groupSlots<T extends { startAt: string }>(
  slots: T[],
  timeZone: string,
): { part: DayPart; slots: T[] }[] {
  const groups: Record<DayPart, T[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const slot of slots) groups[dayPart(slot.startAt, timeZone)].push(slot);
  return (['Morning', 'Afternoon', 'Evening'] as const)
    .map((part) => ({ part, slots: groups[part] }))
    .filter((group) => group.slots.length > 0);
}

// API-041 accepts at most 31 days per request: split a longer window into chunks.
export function dayRanges(dates: string[], size = 31): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = [];
  for (let i = 0; i < dates.length; i += size) {
    const chunk = dates.slice(i, i + size);
    ranges.push({ from: chunk[0]!, to: chunk[chunk.length - 1]! });
  }
  return ranges;
}
