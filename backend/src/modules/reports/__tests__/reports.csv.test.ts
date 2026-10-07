import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, summaryToCsv } from '../reports.csv.js';
import { SummaryQuerySchema, type ReportSummaryDto } from '../reports.schemas.js';
import { datesBetween } from '../reports.service.js';

const money = (amountMinor: number) => ({ amountMinor, currency: 'INR' });
const totals = {
  bookings: 3,
  completed: 2,
  cancelled: 1,
  noShows: 0,
  noShowRate: 0,
  revenue: money(55_000),
  bookedMinutes: 60,
  availableMinutes: 660,
  utilisation: 0.0909,
};

describe('CSV cells (RFC 4180, OWASP CSV injection)', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('Wash, Cut & Style')).toBe('"Wash, Cut & Style"');
    expect(csvCell('The "Classic"')).toBe('"The ""Classic"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(0.25)).toBe('0.25');
    expect(csvCell('')).toBe('');
  });

  it('defuses text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('summaryToCsv (API-072)', () => {
  it('writes total, day, staff and service sections in one table', () => {
    const summary: ReportSummaryDto = {
      from: '2026-10-12',
      to: '2026-10-12',
      timezone: 'Asia/Kolkata',
      totals,
      byDay: [{ date: '2026-10-12', ...totals }],
      byStaff: [{ staffId: 'a'.repeat(24), displayName: '=Ravi', ...totals }],
      byService: [{ serviceId: 'b'.repeat(24), name: 'Haircut', count: 2, revenue: money(55_000) }],
    };
    expect(summaryToCsv(summary).split('\r\n')).toEqual([
      'section,key,name,bookings,completed,cancelled,no_shows,no_show_rate,revenue_minor,currency,booked_minutes,available_minutes,utilisation',
      'total,,,3,2,1,0,0,55000,INR,60,660,0.0909',
      'day,2026-10-12,,3,2,1,0,0,55000,INR,60,660,0.0909',
      `staff,${'a'.repeat(24)},'=Ravi,3,2,1,0,0,55000,INR,60,660,0.0909`,
      `service,${'b'.repeat(24)},Haircut,,2,,,,55000,INR,,,`,
      '',
    ]);
    expect(csvFilename('2026-10-01', '2026-10-31')).toBe(
      'straight-salon-report-2026-10-01-to-2026-10-31.csv',
    );
  });
});

describe('report range (API-071: max 366 days)', () => {
  const parse = (from: string, to: string) => SummaryQuerySchema.safeParse({ from, to }).success;
  it('accepts 1 to 366 days, rejects reversed or longer ranges', () => {
    expect(parse('2026-10-12', '2026-10-12')).toBe(true);
    expect(parse('2024-01-01', '2024-12-31')).toBe(true); // leap year: 366 days
    expect(parse('2025-01-01', '2026-01-02')).toBe(false); // 367 days
    expect(parse('2026-10-13', '2026-10-12')).toBe(false);
  });

  it('datesBetween lists every date, inclusive', () => {
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(datesBetween('2026-10-02', '2026-10-01')).toEqual([]);
  });
});
