import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import BookPage from '@/app/(public)/book/page';
import { WizardProgress } from '@/features/booking/components/wizard-progress';
import { addDays, todayInZone } from '@/lib/time';
import { api, makeUser, server, signedInAs } from '../../helpers/api';
import { categories, ids, makeBooking, page, services, stylists } from '../../helpers/fixtures';
import { setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

// The wizard's presentation (05 §4.1): stepper, selectable cards, time chips grouped by part of
// day, the running-total bar with the step's single primary action, and the success ticket.

const TZ = 'Asia/Kolkata';
const today = todayInZone(TZ);
const firstDay = addDays(today, 1);

function catalogue() {
  server.use(
    http.get(api('/categories'), () => HttpResponse.json(categories)),
    http.get(api('/services'), () => HttpResponse.json(page(services))),
    http.get(api('/staff'), () => HttpResponse.json(stylists)),
    http.get(api('/availability/days'), ({ request }) => {
      const query = new URL(request.url).searchParams;
      return HttpResponse.json({
        from: query.get('from'),
        to: query.get('to'),
        timezone: TZ,
        availableDates: [today, firstDay],
      });
    }),
    http.get(api('/availability'), ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')!;
      return HttpResponse.json({
        date,
        timezone: TZ,
        slots: ['04:30', '05:30', '09:30', '12:30'].map((t) => ({
          startAt: `${date}T${t}:00.000Z`,
          staffIds: [ids.ravi],
        })),
      });
    }),
  );
}

beforeEach(() => {
  setLocation('/book');
});

describe('booking wizard look (05 §4.1)', () => {
  it('stepper: finished steps are checked, the current one is marked, later ones are plain', () => {
    render(<WizardProgress current="time" />);
    const items = within(screen.getByRole('list', { name: 'Booking steps' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual([
      'Services (done)',
      'Stylist (done)',
      '3Date & time',
      '4Confirm',
    ]);
    expect(items[0]!.querySelector('svg')).not.toBeNull();
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items.filter((li) => li.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('services step: eyebrow, checked cards and one Continue in the running-total bar', async () => {
    catalogue();
    renderWithProviders(<BookPage />);
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

    const haircut = await screen.findByRole('button', { name: /^Haircut/ });
    expect(haircut.querySelector('svg.lucide-check')).toBeNull();
    await userEvent.setup().click(haircut);

    const card = screen.getByRole('button', { name: /^Haircut/ });
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card.querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.getByText('1 service')).toBeInTheDocument();
    expect(screen.getByText('45 min · ₹400.00')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1);
  });

  it('stylist step: the bar shows the running total without an extra action', async () => {
    catalogue();
    setLocation('/book', `services=${ids.haircut},${ids.beardTrim}&step=stylist`);
    renderWithProviders(<BookPage />);
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: /Any available/ })).toBeChecked();
    expect(screen.getByText('2 services')).toBeInTheDocument();
    expect(screen.getByText('1 hour · ₹550.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('time step: chips under Morning/Afternoon/Evening headings, today and the chosen time marked', async () => {
    catalogue();
    const start = `${firstDay}T05:30:00.000Z`;
    setLocation('/book', `services=${ids.haircut}&date=${firstDay}&start=${start}&step=time`);
    renderWithProviders(<BookPage />);
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument();

    const morning = await screen.findByRole('group', { name: 'Morning' });
    expect(within(morning).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Evening' })).toBeInTheDocument();
    expect(morning.querySelector('legend svg')).toHaveAttribute('aria-hidden', 'true');

    const chosen = within(morning).getByRole('button', { name: /^11:00/ });
    expect(chosen).toHaveAttribute('aria-pressed', 'true');
    expect(chosen.querySelector('svg.lucide-check')).not.toBeNull();
    expect(within(morning).getByRole('button', { name: /^10:00/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    const current = document.querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute('aria-label')).toMatch(/\d{4}$/);
    expect(screen.getByRole('button', { name: /\d{4}$/, pressed: true })).toBeEnabled();
  });

  it('review step: the Confirm button lives once, inside the form, next to the total', async () => {
    catalogue();
    signedInAs(makeUser());
    setLocation('/book', `services=${ids.haircut}&start=${firstDay}T05:30:00.000Z&step=review`);
    renderWithProviders(<BookPage />);
    const confirm = await screen.findByRole('button', { name: 'Confirm booking' });
    expect(screen.getAllByRole('button', { name: 'Confirm booking' })).toHaveLength(1);
    expect(confirm).toHaveAttribute('type', 'submit');
    expect(confirm.closest('form')).not.toBeNull();
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.getByText('1 service')).toBeInTheDocument();
  });

  it('success: the reference is shown as a ticket stub with both actions', async () => {
    catalogue();
    signedInAs(makeUser());
    const booking = makeBooking();
    server.use(http.get(api('/bookings/:id'), () => HttpResponse.json(booking)));
    setLocation('/book', `step=done&booking=${booking.id}`);
    renderWithProviders(<BookPage />);
    expect(await screen.findByRole('heading', { name: "You're booked!" })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Booking steps' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 4/)).not.toBeInTheDocument();
    const ref = screen.getByText(booking.bookingRef);
    expect(ref).toHaveClass('font-mono');
    expect(ref.previousElementSibling).toHaveTextContent('Booking reference');
    expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My bookings' })).toHaveAttribute('href', '/account');
  });
});
