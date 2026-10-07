import type { ReportsService } from '../modules/reports/reports.service.js';

// `npm run stats:rebuild [-- --from=YYYY-MM-DD --to=YYYY-MM-DD]` (02 §2.17): recomputes
// daily_stats from bookings, for the given salon-local dates or, by default, every date that
// has bookings.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class RebuildArgsError extends Error {
  constructor(message: string) {
    super(`${message}. Usage: stats:rebuild [-- --from=YYYY-MM-DD --to=YYYY-MM-DD]`);
    this.name = 'RebuildArgsError';
  }
}

export type RebuildRange = { from: string; to: string } | null; // null = every booking date

export function parseRebuildArgs(argv: string[]): RebuildRange {
  const value = (name: string) =>
    argv
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.slice(name.length + 3)
      .trim();
  const from = value('from');
  const to = value('to');
  if (from === undefined && to === undefined) return null;
  if (!from || !to) throw new RebuildArgsError('Give both --from and --to, or neither');
  for (const date of [from, to]) {
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
      throw new RebuildArgsError(`"${date}" is not a date`);
    }
  }
  if (from > to) throw new RebuildArgsError('--from must not be after --to');
  return { from, to };
}

export async function rebuildStats(
  reports: Pick<ReportsService, 'rebuild' | 'rebuildAll'>,
  range: RebuildRange,
): Promise<{ from: string; to: string; days: number } | null> {
  if (!range) return reports.rebuildAll();
  return { ...range, days: await reports.rebuild(range.from, range.to) };
}
