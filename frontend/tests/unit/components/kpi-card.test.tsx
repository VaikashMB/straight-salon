import { render, screen } from '@testing-library/react';
import { CalendarDays } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { describeTrend, KpiCard, sparklinePoints } from '@/components/kpi-card';

describe('KPI cards (05 §4.4)', () => {
  it('label, value, hint and a decorative icon in dt/dd', () => {
    render(
      <dl>
        <KpiCard label="Bookings" value={12} hint="Today" icon={CalendarDays} />
      </dl>,
    );
    const term = screen.getByRole('term');
    expect(term).toHaveTextContent('Bookings');
    expect(term.querySelector('[aria-hidden] svg')).not.toBeNull();
    const values = screen.getAllByRole('definition');
    expect(values.map((v) => v.textContent)).toEqual(['12', 'Today']);
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument();
  });

  it('a trend shows a decorative sparkline with the direction in words', () => {
    render(
      <dl>
        <KpiCard
          label="Revenue"
          value="₹100"
          trend={{ values: [1, 2, 3, 4], label: 'Up 133% in the second half' }}
        />
      </dl>,
    );
    expect(screen.getByText('Up 133% in the second half')).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toHaveAttribute('aria-hidden', 'true');
  });

  it('no sparkline for a single value', () => {
    render(
      <dl>
        <KpiCard label="Revenue" value="₹100" trend={{ values: [5], label: 'n/a' }} />
      </dl>,
    );
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument();
    expect(screen.queryByText('n/a')).not.toBeInTheDocument();
  });

  it('sparkline points span the box; flat series sit in the middle', () => {
    expect(sparklinePoints([0, 10], 100, 20)).toBe('2,18 98,2');
    expect(sparklinePoints([3, 3, 3], 100, 20)).toBe('2,10 50,10 98,10');
    expect(sparklinePoints([])).toBeNull();
  });

  it('describes the trend: second half against the first', () => {
    expect(describeTrend([1])).toBeNull();
    expect(describeTrend([10, 10, 20, 20])).toBe('Up 100% in the second half');
    expect(describeTrend([20, 20, 10, 10])).toBe('Down 50% in the second half');
    expect(describeTrend([5, 9, 5])).toBe('Steady across the range');
    expect(describeTrend([0, 4])).toBe('Up in the second half');
    expect(describeTrend([1000, 1001])).toBe('Steady across the range');
  });
});
