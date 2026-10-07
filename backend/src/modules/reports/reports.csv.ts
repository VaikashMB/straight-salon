import type { ReportSummaryDto, ReportTotals } from './reports.schemas.js';

// API-072: the summary (API-071) as one CSV table (RFC 4180, CRLF line ends). Money stays in
// minor units with a currency column, so nothing is lost to rounding.

export const CSV_COLUMNS = [
  'section',
  'key',
  'name',
  'bookings',
  'completed',
  'cancelled',
  'no_shows',
  'no_show_rate',
  'revenue_minor',
  'currency',
  'booked_minutes',
  'available_minutes',
  'utilisation',
] as const;

type Cell = string | number;

// Quotes cells that need it. Text a spreadsheet would run as a formula (=, +, -, @, tab, CR)
// gets a leading apostrophe (OWASP CSV injection).
export function csvCell(value: Cell): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const totalsCells = (t: ReportTotals): Cell[] => [
  t.bookings,
  t.completed,
  t.cancelled,
  t.noShows,
  t.noShowRate,
  t.revenue.amountMinor,
  t.revenue.currency,
  t.bookedMinutes,
  t.availableMinutes,
  t.utilisation,
];

export function summaryToCsv(summary: ReportSummaryDto): string {
  const rows: Cell[][] = [
    [...CSV_COLUMNS],
    ['total', '', '', ...totalsCells(summary.totals)],
    ...summary.byDay.map((d) => ['day', d.date, '', ...totalsCells(d)]),
    ...summary.byStaff.map((s) => ['staff', s.staffId, s.displayName, ...totalsCells(s)]),
    // Services carry only the completed count and revenue.
    ...summary.byService.map((s) => [
      'service',
      s.serviceId,
      s.name,
      '',
      s.count,
      '',
      '',
      '',
      s.revenue.amountMinor,
      s.revenue.currency,
      '',
      '',
      '',
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const csvFilename = (from: string, to: string) =>
  `straight-salon-report-${from}-to-${to}.csv`;
