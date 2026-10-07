import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSalonFormat } from '@/lib/settings';
import { renderWithProviders } from '../helpers/render';

function Prices() {
  const format = useSalonFormat();
  if (!format) return <p>loading</p>;
  return (
    <p>
      {format.money(55_000)} | {format.dateTime('2026-10-12T05:30:00.000Z')} |{' '}
      {format.time('2026-10-12T05:30:00.000Z')} | {format.date('2026-10-12T05:30:00.000Z')}
    </p>
  );
}

describe('salon formatting from public settings (API-016)', () => {
  it('formats in the salon currency and timezone once settings load', async () => {
    renderWithProviders(<Prices />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    const text = (await screen.findByText(/₹550\.00/)).textContent ?? '';
    expect(text).toContain('Mon 12 Oct 2026, 11:00');
    expect(text).toContain('Mon 12 Oct 2026');
  });
});
