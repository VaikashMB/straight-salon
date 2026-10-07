import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import BookingDetailPage from '@/app/(admin)/admin/bookings/[id]/page';
import BookingsPage from '@/app/(admin)/admin/bookings/page';
import CalendarPage from '@/app/(admin)/admin/calendar/page';
import DashboardPage from '@/app/(admin)/admin/page';
import { addDays, todayInZone } from '@/lib/time';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { ids, makeBooking, page, services, stylists } from '../../helpers/fixtures';
import { renderWithProviders } from '../../helpers/render';

const TZ = 'Asia/Kolkata';
const today = todayInZone(TZ);
const user = () => userEvent.setup();
const reception = () => signedInAs(makeUser({ name: 'Front Desk', role: 'RECEPTIONIST' }));

const weekly = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isWorking: true,
  start: '10:00',
  end: '19:00',
  breaks: [{ start: '13:30', end: '14:00' }],
}));

describe('admin dashboard (FR-070, API-070)', () => {
  it('KPI cards, per-stylist timeline and the next two hours', async () => {
    reception();
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    server.use(
      http.get(api('/reports/dashboard'), () =>
        HttpResponse.json({
          date: today,
          timezone: TZ,
          generatedAt: new Date().toISOString(),
          counts: {
            BOOKED: 3,
            CHECKED_IN: 1,
            IN_SERVICE: 0,
            COMPLETED: 4,
            CANCELLED: 1,
            NO_SHOW: 2,
          },
          totals: { bookings: 11, revenue: { amountMinor: 1_250_000, currency: 'INR' } },
          staff: [
            {
              staffId: ids.ravi,
              displayName: 'Ravi',
              bookings: [
                {
                  id: 'b1',
                  bookingRef: 'SS-1',
                  status: 'BOOKED',
                  startAt: soon,
                  endAt: soon,
                  customerName: 'Ananya Rao',
                  services: ['Haircut'],
                },
                {
                  id: 'b2',
                  bookingRef: 'SS-2',
                  status: 'COMPLETED',
                  startAt: `${today}T04:30:00.000Z`,
                  endAt: `${today}T05:30:00.000Z`,
                  customerName: 'Kiran',
                  services: ['Beard Trim'],
                },
              ],
            },
            { staffId: ids.meera, displayName: 'Meera', bookings: [] },
          ],
        }),
      ),
    );
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("Today's bookings")).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('₹12,500.00')).toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'By stylist' });
    expect(
      within(timeline).getByRole('link', { name: /Kiran, Beard Trim, Completed/ }),
    ).toHaveAttribute('href', '/admin/bookings/b2');
    const next = screen.getByRole('region', { name: 'Next 2 hours' });
    expect(within(next).getByText('Ananya Rao')).toBeInTheDocument();
    expect(within(next).queryByText('Kiran')).not.toBeInTheDocument();
  });

  it('a failed load offers a retry', async () => {
    reception();
    server.use(http.get(api('/reports/dashboard'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('admin calendar (05 §4.4)', () => {
  function calendarApi() {
    const dates: string[] = [];
    let status: unknown = null;
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/staff/:id/schedule'), ({ params }) =>
        HttpResponse.json({ staffId: params.id, weekly }),
      ),
      http.get(api('/staff/:id/time-off'), ({ params }) =>
        HttpResponse.json(
          params.id === ids.meera
            ? [
                {
                  id: 't',
                  staffId: ids.meera,
                  startAt: `${today}T09:30:00.000Z`,
                  endAt: `${today}T10:30:00.000Z`,
                  reason: 'Dentist',
                  createdBy: 'u',
                  createdAt: today,
                },
              ]
            : [],
        ),
      ),
      http.get(api('/bookings'), ({ request }) => {
        dates.push(new URL(request.url).searchParams.get('date')!);
        return HttpResponse.json(
          page([
            makeBooking({ startAt: `${today}T05:30:00.000Z`, endAt: `${today}T06:30:00.000Z` }),
          ]),
        );
      }),
      http.post(api('/bookings/:id/status'), async ({ request }) => {
        status = await request.json();
        return HttpResponse.json(makeBooking({ status: 'CHECKED_IN' }));
      }),
    );
    return { dates, status: () => status };
  }

  it('columns per stylist, blocks by status, hatched breaks and time off; drawer with actions', async () => {
    reception();
    const calls = calendarApi();
    renderWithProviders(<CalendarPage />);
    const block = await screen.findByRole('button', {
      name: /Ananya Rao, Haircut, Beard Trim, Booked/,
    });
    expect(screen.getAllByText('Break').length).toBeGreaterThan(0);
    expect(await screen.findByText('Time off: Dentist')).toBeInTheDocument();
    expect(screen.getByText('Meera')).toBeInTheDocument();
    await user().click(block);
    const drawer = await screen.findByRole('dialog', { name: 'Ananya Rao' });
    expect(within(drawer).getByRole('link', { name: 'Open booking' })).toHaveAttribute(
      'href',
      `/admin/bookings/${ids.booking}`,
    );
    await user().click(within(drawer).getByRole('button', { name: 'Check in: Ananya Rao' }));
    await waitFor(() => expect(calls.status()).toEqual({ status: 'CHECKED_IN' }));
    await user().click(within(drawer).getByRole('button', { name: 'Close' }));

    await user().click(screen.getByRole('button', { name: 'Next day' }));
    await waitFor(() => expect(calls.dates).toContain(addDays(today, 1)));
    await user().click(screen.getByRole('button', { name: 'Previous day' }));
    await user().click(screen.getByRole('button', { name: 'Today' }));
  });

  it('closed days and failures', async () => {
    reception();
    calendarApi();
    const closed = {
      ...(await import('../../helpers/api')).settings,
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isOpen: false,
        open: '09:30',
        close: '20:30',
      })),
    };
    server.use(http.get(api('/settings/public'), () => HttpResponse.json(closed)));
    const view = renderWithProviders(<CalendarPage />);
    expect(await screen.findByText('The salon is closed on this day')).toBeInTheDocument();
    view.unmount();

    server.use(http.get(api('/bookings'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<CalendarPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('admin bookings table (API-052)', () => {
  it('filters, sorts and pages on the server', async () => {
    reception();
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/bookings'), ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(page([makeBooking()], { totalPages: 3 }));
      }),
    );
    renderWithProviders(<BookingsPage />);
    const u = user();
    expect(await screen.findByText('SS-261012-7KQ2')).toBeInTheDocument();
    expect(queries.at(-1)?.get('date')).toBe(today);
    await u.selectOptions(screen.getByLabelText('Status'), 'Completed');
    await u.selectOptions(screen.getByLabelText('Stylist'), 'Ravi');
    await u.type(screen.getByLabelText('Search'), 'SS-26');
    await u.clear(screen.getByLabelText('Date'));
    await u.click(screen.getByRole('button', { name: /When/ }));
    await u.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      const q = queries.at(-1)!;
      expect(Object.fromEntries(q)).toMatchObject({
        status: 'COMPLETED',
        staffId: ids.ravi,
        q: 'SS-26',
        sort: '-startAt',
        page: '2',
      });
      expect(q.get('date')).toBeNull();
    });
  });

  it('records a payment with a discount (FR-043, BR-011, API-057)', async () => {
    reception();
    let body: unknown = null;
    let key: string | null = null;
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/bookings'), () =>
        HttpResponse.json(page([makeBooking({ status: 'COMPLETED' })])),
      ),
      http.post(api('/bookings/:id/payment'), async ({ request }) => {
        body = await request.json();
        key = request.headers.get('idempotency-key');
        return HttpResponse.json(makeBooking({ status: 'COMPLETED', payment: { status: 'PAID' } }));
      }),
    );
    renderWithProviders(<BookingsPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
    expect(within(dialog).getByText('₹550.00')).toBeInTheDocument();
    await u.type(within(dialog).getByLabelText('Discount (optional)'), '9999');
    expect(within(dialog).getByText('Enter a valid amount up to the total')).toBeInTheDocument();
    await u.clear(within(dialog).getByLabelText('Discount (optional)'));
    await u.type(within(dialog).getByLabelText('Discount (optional)'), '50');
    await u.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Give a reason for the discount.',
    );
    await u.type(within(dialog).getByLabelText('Discount reason'), 'Regular');
    await u.selectOptions(within(dialog).getByLabelText('Method'), 'UPI');
    expect(within(dialog).getByText('₹500.00')).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Payment recorded for SS-261012-7KQ2.'),
    );
    expect(body).toEqual({
      method: 'UPI',
      amountPaidMinor: 50_000,
      discountMinor: 5_000,
      discountReason: 'Regular',
    });
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
  });

  it('a second payment is refused with the mapped message', async () => {
    reception();
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/bookings'), () =>
        HttpResponse.json(page([makeBooking({ status: 'COMPLETED' })])),
      ),
      http.post(api('/bookings/:id/payment'), () => problem(409, 'PAYMENT_ALREADY_RECORDED')),
    );
    renderWithProviders(<BookingsPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already been recorded');
  });

  it('empty and failing lists', async () => {
    reception();
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/bookings'), () => HttpResponse.json(page([]))),
    );
    const view = renderWithProviders(<BookingsPage />);
    expect(await screen.findByText('No bookings match')).toBeInTheDocument();
    view.unmount();
    server.use(http.get(api('/bookings'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<BookingsPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('new walk-in (US-03, FR-037, API-013, API-050)', () => {
  function walkInApi(found: ReturnType<typeof makeUser>[] = []) {
    const posted: { walkIn: unknown; booking: unknown; searches: string[] } = {
      walkIn: null,
      booking: null,
      searches: [],
    };
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/services'), () => HttpResponse.json(page(services))),
      http.get(api('/bookings'), () => HttpResponse.json(page([]))),
      http.get(api('/users'), ({ request }) => {
        posted.searches.push(new URL(request.url).searchParams.get('q')!);
        return HttpResponse.json(page(found));
      }),
      http.post(api('/users/walk-in'), async ({ request }) => {
        posted.walkIn = await request.json();
        return HttpResponse.json(makeUser({ id: ids.customer, name: 'Walk In', isWalkIn: true }), {
          status: 201,
        });
      }),
      http.post(api('/bookings'), async ({ request }) => {
        posted.booking = await request.json();
        return HttpResponse.json(makeBooking({ status: 'CHECKED_IN', source: 'WALK_IN' }), {
          status: 201,
        });
      }),
    );
    return posted;
  }

  it('phone not found → add walk-in → services and stylist → checked in now', async () => {
    reception();
    const posted = walkInApi();
    renderWithProviders(<BookingsPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: /New walk-in/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New walk-in' });
    await u.click(within(dialog).getByRole('button', { name: 'Find' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Enter a valid mobile number.',
    );
    await u.type(within(dialog).getByLabelText("Customer's mobile number"), '98765 43210');
    await u.click(within(dialog).getByRole('button', { name: 'Find' }));
    await u.type(await within(dialog).findByLabelText("Customer's name"), 'Walk In');
    await u.click(within(dialog).getByRole('button', { name: 'Add customer' }));
    expect(posted.walkIn).toEqual({ name: 'Walk In', phone: '+919876543210' });
    expect(posted.searches).toEqual(['+919876543210']);

    await u.click(await within(dialog).findByRole('button', { name: 'Check in now' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Choose at least one service.',
    );
    await u.click(within(dialog).getByLabelText('Haircut · 45 min'));
    await u.selectOptions(within(dialog).getByLabelText('Stylist'), 'Ravi');
    await u.click(within(dialog).getByRole('button', { name: 'Check in now' }));
    await waitFor(() =>
      expect(posted.booking).toEqual({
        customerId: ids.customer,
        serviceIds: [ids.haircut],
        staffId: ids.ravi,
        checkInNow: true,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/^SS-261012-7KQ2: Walk In with Ravi at/),
    );
  });

  it('an existing customer can be chosen, and a time booked for later (source PHONE)', async () => {
    reception();
    const tomorrow = addDays(today, 1);
    const posted = walkInApi([makeUser({ name: 'Ananya Rao' })]);
    server.use(
      http.get(api('/availability/days'), () =>
        HttpResponse.json({ from: today, to: tomorrow, timezone: TZ, availableDates: [tomorrow] }),
      ),
      http.get(api('/availability'), () =>
        HttpResponse.json({
          date: tomorrow,
          timezone: TZ,
          slots: [{ startAt: `${tomorrow}T05:30:00.000Z`, staffIds: [ids.ravi] }],
        }),
      ),
    );
    renderWithProviders(<BookingsPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: /New walk-in/ }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText("Customer's mobile number"), '+919876543212');
    await u.click(within(dialog).getByRole('button', { name: 'Find' }));
    await u.click(await within(dialog).findByRole('button', { name: 'Choose' }));
    await u.click(within(dialog).getByLabelText('Book a time'));
    await u.click(within(dialog).getByLabelText('Haircut · 45 min'));
    await u.click(within(dialog).getByRole('button', { name: 'Create booking' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Pick a time.');
    await u.click(await within(dialog).findByRole('button', { name: /^11:00/ }));
    await u.click(within(dialog).getByRole('button', { name: 'Create booking' }));
    await waitFor(() =>
      expect(posted.booking).toEqual({
        customerId: ids.customer,
        serviceIds: [ids.haircut],
        staffId: 'any',
        startAt: `${tomorrow}T05:30:00.000Z`,
      }),
    );
  });

  it('a staff member’s phone cannot become a walk-in', async () => {
    reception();
    walkInApi();
    server.use(http.post(api('/users/walk-in'), () => problem(409, 'DUPLICATE')));
    renderWithProviders(<BookingsPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: /New walk-in/ }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText("Customer's mobile number"), '9000000002');
    await u.click(within(dialog).getByRole('button', { name: 'Find' }));
    await u.click(await within(dialog).findByRole('button', { name: 'Add customer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Enter the customer's name.",
    );
    await u.type(within(dialog).getByLabelText("Customer's name"), 'Someone');
    await u.click(within(dialog).getByRole('button', { name: 'Add customer' }));
    expect(
      await within(dialog).findByText('This number belongs to a salon staff account.'),
    ).toBeInTheDocument();
  });
});

describe('admin booking detail (API-053, API-058)', () => {
  const soon = () => new Date(Date.now() + 30 * 60_000).toISOString();

  function detailApi(booking = makeBooking()) {
    const posted: Record<string, unknown> = {};
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/bookings/:id'), () => HttpResponse.json(booking)),
      http.get(api('/bookings/:id/history'), () =>
        HttpResponse.json({
          statusHistory: [{ status: 'BOOKED', at: '2026-10-06T09:12:44.000Z', by: 'u1' }],
          audit: [
            {
              at: '2026-10-06T09:12:44.000Z',
              action: 'booking.create',
              actor: { id: 'u1', role: 'CUSTOMER' },
              diff: ['status'],
              before: null,
              after: {},
            },
          ],
        }),
      ),
      http.post(api('/bookings/:id/cancel'), async ({ request }) => {
        posted.cancel = await request.json();
        return HttpResponse.json(makeBooking({ status: 'CANCELLED' }));
      }),
      http.post(api('/bookings/:id/reschedule'), async ({ request }) => {
        posted.reschedule = await request.json();
        return HttpResponse.json(booking);
      }),
    );
    return posted;
  }

  it('shows the customer, payment and history', async () => {
    reception();
    detailApi(
      makeBooking({
        status: 'COMPLETED',
        source: 'WALK_IN',
        notes: 'Allergic to dye',
        payment: {
          status: 'PAID',
          method: 'UPI',
          amountPaid: { amountMinor: 50_000, currency: 'INR' },
          discount: { amountMinor: 5_000, currency: 'INR' },
          discountReason: 'Regular',
        },
        cancellation: undefined,
      }),
    );
    renderWithProviders(await BookingDetailPage({ params: Promise.resolve({ id: ids.booking }) }));
    expect(await screen.findByRole('heading', { name: 'SS-261012-7KQ2' })).toBeInTheDocument();
    expect(screen.getByText(/Walk-in/)).toBeInTheDocument();
    expect(
      screen.getByText(/Paid ₹500\.00 by UPI \(discount ₹50\.00: Regular\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('Allergic to dye')).toBeInTheDocument();
    expect(await screen.findByText(/booking\.create/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('cancelling inside the cut-off needs an override and a reason (BR-006)', async () => {
    reception();
    const posted = detailApi(makeBooking({ startAt: soon() }));
    renderWithProviders(await BookingDetailPage({ params: Promise.resolve({ id: ids.booking }) }));
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Override the cut-off');
    await u.click(within(dialog).getByLabelText('Override the cut-off'));
    await u.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason for the override.');
    await u.type(within(dialog).getByLabelText('Reason'), 'Customer called');
    await u.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() =>
      expect(posted.cancel).toEqual({ reason: 'Customer called', override: true }),
    );
  });

  it('reschedules to another stylist with an override (BR-015)', async () => {
    reception();
    const tomorrow = addDays(today, 1);
    const posted = detailApi(
      makeBooking({ startAt: soon(), services: [makeBooking().services[0]!] }),
    );
    server.use(
      http.get(api('/availability/days'), () =>
        HttpResponse.json({ from: today, to: tomorrow, timezone: TZ, availableDates: [tomorrow] }),
      ),
      http.get(api('/availability'), () =>
        HttpResponse.json({
          date: tomorrow,
          timezone: TZ,
          slots: [{ startAt: `${tomorrow}T05:30:00.000Z`, staffIds: [ids.meera] }],
        }),
      ),
    );
    renderWithProviders(await BookingDetailPage({ params: Promise.resolve({ id: ids.booking }) }));
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('dialog');
    await u.selectOptions(within(dialog).getByLabelText('Stylist'), 'Meera');
    await u.click(await within(dialog).findByRole('button', { name: /^11:00/ }));
    await u.click(within(dialog).getByRole('button', { name: /^Move to/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Override the cut-off');
    await u.click(within(dialog).getByLabelText('Override the cut-off'));
    await u.type(within(dialog).getByLabelText('Reason'), 'Ravi is ill');
    await u.click(within(dialog).getByRole('button', { name: /^Move to/ }));
    await waitFor(() =>
      expect(posted.reschedule).toEqual({
        startAt: `${tomorrow}T05:30:00.000Z`,
        staffId: ids.meera,
        override: true,
        reason: 'Ravi is ill',
      }),
    );
  });

  it('not found and failures', async () => {
    reception();
    server.use(
      http.get(api('/bookings/:id'), () => problem(404, 'NOT_FOUND')),
      http.get(api('/bookings/:id/history'), () => problem(404, 'NOT_FOUND')),
    );
    const view = renderWithProviders(
      await BookingDetailPage({ params: Promise.resolve({ id: ids.booking }) }),
    );
    expect(await screen.findByRole('heading', { name: 'Booking not found' })).toBeInTheDocument();
    view.unmount();
    server.use(http.get(api('/bookings/:id'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(await BookingDetailPage({ params: Promise.resolve({ id: ids.booking }) }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
