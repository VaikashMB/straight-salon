import { describe, expect, it } from 'vitest';
import { insideCutoff } from '@/features/booking/mutations';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { StatusBadge } from '@/features/booking/components/status-badge';
import {
  firstName,
  nextStatuses,
  STATUS_DOT,
  STATUS_EDGE,
  STATUS_ICON,
  STATUS_LABEL,
  type BookingStatus,
} from '@/features/booking/status';

describe('BR-010 next status actions', () => {
  const now = new Date('2026-10-12T06:00:00.000Z');
  it('offers only the valid next step; no-show only after the start (decision 2026-10-07)', () => {
    expect(nextStatuses({ status: 'BOOKED', startAt: '2026-10-12T07:00:00.000Z' }, now)).toEqual([
      'CHECKED_IN',
    ]);
    expect(nextStatuses({ status: 'BOOKED', startAt: '2026-10-12T05:30:00.000Z' }, now)).toEqual([
      'CHECKED_IN',
      'NO_SHOW',
    ]);
    expect(nextStatuses({ status: 'CHECKED_IN', startAt: '' }, now)).toEqual(['IN_SERVICE']);
    expect(nextStatuses({ status: 'IN_SERVICE', startAt: '' }, now)).toEqual(['COMPLETED']);
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(nextStatuses({ status, startAt: '' }, now)).toEqual([]);
    }
  });

  it('BR-006 cut-off window and first names', () => {
    expect(insideCutoff('2026-10-12T07:59:00.000Z', 120, now)).toBe(true);
    expect(insideCutoff('2026-10-12T08:00:00.000Z', 120, now)).toBe(false);
    expect(firstName('Ananya Rao')).toBe('Ananya');
  });
});

describe('status badges (05 §7: colour is never the only indicator)', () => {
  const all = Object.keys(STATUS_LABEL) as BookingStatus[];

  it('every status has an icon, an edge and a dot colour', () => {
    for (const status of all) {
      expect(STATUS_ICON[status]).toBeTruthy();
      expect(STATUS_EDGE[status]).toMatch(/^border-l-/);
      expect(STATUS_DOT[status]).toMatch(/^bg-/);
    }
    expect(new Set(all.map((s) => STATUS_ICON[s])).size).toBe(all.length);
  });

  it('renders the label as text with a decorative icon', () => {
    render(createElement(StatusBadge, { status: 'NO_SHOW' }));
    const badge = screen.getByText('No-show');
    expect(badge).toHaveAttribute('data-status', 'NO_SHOW');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
