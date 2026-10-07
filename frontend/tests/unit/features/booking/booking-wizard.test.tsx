import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookPage from '@/app/(public)/book/page';
import { addDays, todayInZone } from '@/lib/time';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import {
  categories,
  ids,
  makeBooking,
  makeService,
  page,
  services,
  stylists,
} from '../../helpers/fixtures';
import { router, setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

const TZ = 'Asia/Kolkata';
const today = todayInZone(TZ);
const firstDay = addDays(today, 1);

function catalogue(list = services) {
  server.use(
    http.get(api('/categories'), () => HttpResponse.json(categories)),
    http.get(api('/services'), () => HttpResponse.json(page(list))),
    http.get(api('/staff'), () => HttpResponse.json(stylists)),
  );
}

// Days: tomorrow and the day after next. Slots at 11:00, 15:00 and 18:00 salon time.
function availability({ days = [firstDay, addDays(today, 3)], slots = true } = {}) {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(api('/availability/days'), ({ request }) => {
      const query = new URL(request.url).searchParams;
      return HttpResponse.json({
        from: query.get('from'),
        to: query.get('to'),
        timezone: TZ,
        availableDates: days,
      });
    }),
    http.get(api('/availability'), ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.push(query);
      const date = query.get('date')!;
      return HttpResponse.json({
        date,
        timezone: TZ,
        slots: slots
          ? ['05:30', '09:30', '12:30'].map((t) => ({
              startAt: `${date}T${t}:00.000Z`,
              staffIds: [ids.ravi],
            }))
          : [],
      });
    }),
  );
  return calls;
}

const user = () => userEvent.setup();
const query = () => new URLSearchParams(router.replace.mock.lastCall?.[0].split('?')[1]);

beforeEach(() => {
  setLocation('/book');
});

describe('booking wizard (05 §4.1, US-01)', () => {
  it('books end to end: services → stylist → time → sign in → confirm → success', async () => {
    catalogue();
    const slotCalls = availability();
    let posted: { body: unknown; key: string | null } | null = null;
    const booking = makeBooking({ startAt: `${firstDay}T05:30:00.000Z` });
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({ user: makeUser(), accessToken: 'tok' }),
      ),
      http.post(api('/bookings'), async ({ request }) => {
        posted = { body: await request.json(), key: request.headers.get('idempotency-key') };
        return HttpResponse.json(booking, { status: 201 });
      }),
      http.get(api('/bookings/:id'), () => HttpResponse.json(booking)),
    );
    const u = user();
    renderWithProviders(<BookPage />);

    // 1. Services, with a running total.
    expect(
      await screen.findByRole('heading', { name: 'Choose your services' }),
    ).toBeInTheDocument();
    await u.click(await screen.findByRole('button', { name: /^Haircut/ }));
    await u.click(screen.getByRole('button', { name: /^Beard Trim/ }));
    expect(screen.getByRole('button', { name: /^Haircut/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/1 hour · ₹550\.00/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Continue' }));

    // 2. Stylist: "any" plus only those who do both services.
    expect(await screen.findByRole('heading', { name: 'Choose a stylist' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Stylist' });
    expect(within(group).getByRole('radio', { name: /Any available/ })).toBeChecked();
    expect(within(group).queryByRole('radio', { name: /Meera/ })).not.toBeInTheDocument();
    await u.click(within(group).getByRole('radio', { name: /Ravi/ }));

    // 3. Date & time: opens on the first bookable day; slots grouped by part of day.
    expect(
      await screen.findByRole('heading', { name: 'Pick a date and time' }),
    ).toBeInTheDocument();
    const morning = await screen.findByRole('group', { name: 'Morning' });
    expect(screen.getByRole('group', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Evening' })).toBeInTheDocument();
    expect(slotCalls.at(-1)?.get('staffId')).toBe(ids.ravi);
    expect(slotCalls.at(-1)?.get('serviceIds')).toBe(`${ids.haircut},${ids.beardTrim}`);
    const unavailable = screen
      .getAllByRole('button', { name: /\d{4}$/ })
      .filter((b) => b.hasAttribute('disabled'));
    expect(unavailable.length).toBeGreaterThan(20);
    await u.click(within(morning).getByRole('button', { name: /^11:00/ }));

    // 4. Review: visitors sign in inline, then confirm.
    expect(await screen.findByRole('heading', { name: 'Review and confirm' })).toBeInTheDocument();
    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toMatch(
      /^\/register\?next=%2Fbook%3F.*step%3Dreview/,
    );
    await u.type(screen.getByLabelText('Email'), 'ananya@example.com');
    await u.type(screen.getByLabelText('Password'), 'Fade-and-Trim7');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    await u.type(await screen.findByLabelText('Notes for the salon (optional)'), 'Short on top');
    await u.click(screen.getByRole('button', { name: 'Confirm booking' }));

    // 5. Success.
    expect(await screen.findByRole('heading', { name: "You're booked!" })).toBeInTheDocument();
    expect(posted).toEqual({
      body: {
        serviceIds: [ids.haircut, ids.beardTrim],
        staffId: ids.ravi,
        startAt: `${firstDay}T05:30:00.000Z`,
        notes: 'Short on top',
      },
      key: expect.stringMatching(/^[A-Za-z0-9_-]{8,100}$/) as string,
    });
    expect(toast.success).toHaveBeenCalledWith('Booked! Your reference is SS-261012-7KQ2.');
    expect(query().get('step')).toBe('done');
    expect(screen.getAllByText('SS-261012-7KQ2')).not.toHaveLength(0);
    expect(screen.getByRole('link', { name: 'My bookings' })).toHaveAttribute('href', '/account');

    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await u.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('409 SLOT_UNAVAILABLE: toast, refreshed slots, back to step 3 keeping the rest (US-01)', async () => {
    catalogue();
    availability();
    signedInAs(makeUser());
    server.use(http.post(api('/bookings'), () => problem(409, 'SLOT_UNAVAILABLE')));
    const start = `${firstDay}T05:30:00.000Z`;
    setLocation('/book', `services=${ids.haircut}&date=${firstDay}&start=${start}&step=review`);
    renderWithProviders(<BookPage />);
    await user().click(await screen.findByRole('button', { name: 'Confirm booking' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no longer available/)),
    );
    expect(
      await screen.findByRole('heading', { name: 'Pick a date and time' }),
    ).toBeInTheDocument();
    const last = new URLSearchParams(router.push.mock.lastCall?.[0].split('?')[1]);
    expect(last.get('services')).toBe(ids.haircut);
    expect(last.get('date')).toBe(firstDay);
    expect(last.get('start')).toBeNull();
  });

  it('other booking errors stay on the review step with a mapped message', async () => {
    catalogue();
    availability();
    signedInAs(makeUser());
    server.use(http.post(api('/bookings'), () => problem(422, 'BOOKING_LIMIT_REACHED')));
    setLocation('/book', `services=${ids.haircut}&start=${firstDay}T05:30:00.000Z&step=review`);
    renderWithProviders(<BookPage />);
    await user().click(await screen.findByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'maximum number of upcoming bookings',
    );
  });

  it('salon accounts are pointed to the admin area instead of booking for themselves', async () => {
    catalogue();
    signedInAs(makeUser({ role: 'RECEPTIONIST' }));
    setLocation('/book', `services=${ids.haircut}&start=${firstDay}T05:30:00.000Z&step=review`);
    renderWithProviders(<BookPage />);
    expect(await screen.findByText(/Book for customers from the admin area/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
  });

  it('inline sign-in shows one generic message for wrong credentials', async () => {
    catalogue();
    server.use(http.post(api('/auth/login'), () => problem(401, 'UNAUTHENTICATED')));
    setLocation('/book', `services=${ids.haircut}&start=${firstDay}T05:30:00.000Z&step=review`);
    renderWithProviders(<BookPage />);
    const u = user();
    await u.type(await screen.findByLabelText('Email'), 'ananya@example.com');
    await u.type(screen.getByLabelText('Password'), 'nope');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('BR-008: at most 5 services per booking', async () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      makeService({ id: `6712c0f9a1b2c3d4e5f6e00${i}`, slug: `s${i}`, name: `Service ${i}` }),
    );
    catalogue(six);
    renderWithProviders(<BookPage />);
    const u = user();
    for (let i = 0; i < 5; i++)
      await u.click(await screen.findByRole('button', { name: new RegExp(`^Service ${i}`) }));
    expect(screen.getByRole('status')).toHaveTextContent('up to 5 services');
    expect(screen.getByRole('button', { name: /^Service 5/ })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: /^Service 0/ }));
    expect(screen.getByRole('button', { name: /^Service 5/ })).toBeEnabled();
  });

  it('coming from a stylist page lists only their services, and Back works', async () => {
    catalogue();
    setLocation('/book', `staff=${ids.meera}`);
    renderWithProviders(<BookPage />);
    const u = user();
    expect(await screen.findByText(/Showing the services Meera offers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Beard Trim/ })).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /^Hair Colour/ }));
    await u.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('radio', { name: /Meera/ })).toBeChecked();
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('heading', { name: 'Choose your services' }),
    ).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Show all services' }));
    expect(await screen.findByRole('button', { name: /^Beard Trim/ })).toBeInTheDocument();
  });

  it('services no single stylist offers together cannot be booked', async () => {
    catalogue();
    setLocation('/book', `services=${ids.beardTrim},${ids.colour}&step=stylist`);
    renderWithProviders(<BookPage />);
    expect(
      await screen.findByText(/No single stylist offers all of these services/),
    ).toBeInTheDocument();
  });

  it('empty days and empty slots explain what to do', async () => {
    catalogue();
    availability({ days: [] });
    setLocation('/book', `services=${ids.haircut}&step=time`);
    const view = renderWithProviders(<BookPage />);
    expect(await screen.findByText('No free times in the next few weeks')).toBeInTheDocument();
    view.unmount();

    availability({ slots: false });
    setLocation('/book', `services=${ids.haircut}&date=${firstDay}&step=time`);
    renderWithProviders(<BookPage />);
    expect(await screen.findByText('No times left on this day')).toBeInTheDocument();
  });

  it('catalogue and availability failures offer a retry', async () => {
    server.use(
      http.get(api('/categories'), () => problem(500, 'INTERNAL_ERROR')),
      http.get(api('/services'), () => HttpResponse.json(page(services))),
      http.get(api('/staff'), () => problem(500, 'INTERNAL_ERROR')),
    );
    const view = renderWithProviders(<BookPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    view.unmount();

    setLocation('/book', `services=${ids.haircut}&step=stylist`);
    const stylistView = renderWithProviders(<BookPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    stylistView.unmount();

    catalogue();
    server.use(http.get(api('/availability/days'), () => problem(422, 'VALIDATION_FAILED')));
    setLocation('/book', `services=${ids.haircut}&step=time`);
    renderWithProviders(<BookPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('check the highlighted fields');
  });
});
