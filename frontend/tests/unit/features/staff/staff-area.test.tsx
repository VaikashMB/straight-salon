import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import TimeOffPage from '@/app/(staff)/staff/time-off/page';
import StaffPage from '@/app/(staff)/staff/page';
import WeekPage from '@/app/(staff)/staff/week/page';
import { addDays, todayInZone } from '@/lib/time';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { ids, makeBooking, page, tokenWith } from '../../helpers/fixtures';
import { renderWithProviders } from '../../helpers/render';

const TZ = 'Asia/Kolkata';
const today = todayInZone(TZ);
const user = () => userEvent.setup();

function asStylist() {
  signedInAs(
    makeUser({ name: 'Ravi Kumar', role: 'STAFF' }),
    tokenWith({ role: 'STAFF', staffId: ids.ravi }),
  );
}

const weekly = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isWorking: dayOfWeek !== 1,
  start: '10:00',
  end: '19:00',
  breaks: [],
}));

describe('staff "My day" (US-04, 05 §4.3)', () => {
  it('lists today’s bookings with only the next valid action, and moves them on (API-056)', async () => {
    asStylist();
    const queries: URLSearchParams[] = [];
    let changed: unknown = null;
    server.use(
      http.get(api('/bookings'), ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([
            makeBooking({
              customer: { id: ids.customer, name: 'Ananya', phone: '+9198******12' },
              startAt: `${today}T03:30:00.000Z`,
              endAt: `${today}T04:30:00.000Z`,
              notes: 'Short on top',
            }),
            makeBooking({
              id: '6712c0f9a1b2c3d4e5f60790',
              bookingRef: 'SS-2',
              status: 'IN_SERVICE',
              customer: { id: 'c2', name: 'Kiran', phone: '' },
            }),
            makeBooking({
              id: '6712c0f9a1b2c3d4e5f60791',
              bookingRef: 'SS-3',
              status: 'CANCELLED',
            }),
          ]),
        );
      }),
      http.post(api('/bookings/:id/status'), async ({ request }) => {
        changed = await request.json();
        return HttpResponse.json(makeBooking({ status: 'CHECKED_IN' }));
      }),
    );
    renderWithProviders(<StaffPage />);
    const items = await screen.findAllByRole('article');
    expect(items).toHaveLength(2); // cancelled ones are left out
    expect(queries[0]?.get('date')).toBe(today);
    expect(within(items[0]!).getByText('Note: Short on top')).toBeInTheDocument();
    // Started already: check in or no-show; in service: complete.
    expect(
      within(items[0]!).getByRole('button', { name: 'Mark no-show: Ananya' }),
    ).toBeInTheDocument();
    expect(within(items[1]!).getByRole('button', { name: 'Complete: Kiran' })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button', { name: /Check in/ })).not.toBeInTheDocument();
    await user().click(within(items[0]!).getByRole('button', { name: 'Check in: Ananya' }));
    await waitFor(() => expect(changed).toEqual({ status: 'CHECKED_IN' }));
    expect(toast.success).toHaveBeenCalledWith('SS-261012-7KQ2: Checked in');
  });

  it('reports a refused status change', async () => {
    asStylist();
    server.use(
      http.get(api('/bookings'), () =>
        HttpResponse.json(page([makeBooking({ status: 'CHECKED_IN' })])),
      ),
      http.post(api('/bookings/:id/status'), () => problem(422, 'INVALID_STATUS_TRANSITION')),
    );
    renderWithProviders(<StaffPage />);
    await user().click(await screen.findByRole('button', { name: /^Start service/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This booking can't be moved to that status."),
    );
  });

  it('empty and failing days', async () => {
    asStylist();
    server.use(http.get(api('/bookings'), () => HttpResponse.json(page([]))));
    const view = renderWithProviders(<StaffPage />);
    expect(await screen.findByText('No bookings today')).toBeInTheDocument();
    view.unmount();
    server.use(http.get(api('/bookings'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<StaffPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('staff week', () => {
  it('shows working hours and bookings per day, and pages by week', async () => {
    asStylist();
    const ranges: string[] = [];
    server.use(
      http.get(api('/staff/:id/schedule'), () => HttpResponse.json({ staffId: ids.ravi, weekly })),
      http.get(api('/bookings'), ({ request }) => {
        const q = new URL(request.url).searchParams;
        ranges.push(`${q.get('from')}..${q.get('to')}`);
        return HttpResponse.json(page([makeBooking({ startAt: `${today}T05:30:00.000Z` })]));
      }),
    );
    renderWithProviders(<WeekPage />);
    expect(await screen.findByText(/Ananya · Haircut, Beard Trim/)).toBeInTheDocument();
    expect(await screen.findByText('Day off')).toBeInTheDocument();
    expect(screen.getAllByText('10:00–19:00')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
    await user().click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(ranges).toContain(`${addDays(today, 7)}..${addDays(today, 13)}`));
  });
});

describe('staff time off (FR-024, API-035..037)', () => {
  it('adds and removes their own time off', async () => {
    asStylist();
    let added: unknown = null;
    let deleted = false;
    server.use(
      http.get(api('/staff/:id/time-off'), () =>
        HttpResponse.json([
          {
            id: 't1',
            staffId: ids.ravi,
            startAt: `${addDays(today, 2)}T03:30:00.000Z`,
            endAt: `${addDays(today, 2)}T12:30:00.000Z`,
            reason: 'Wedding',
            createdBy: 'u',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        ]),
      ),
      http.post(api('/staff/:id/time-off'), async ({ request, params }) => {
        added = { staffId: params.id, body: await request.json() };
        return HttpResponse.json({}, { status: 201 });
      }),
      http.delete(api('/staff/:id/time-off/:tid'), () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<TimeOffPage />);
    const u = user();
    expect(await screen.findByText(/Wedding/)).toBeInTheDocument();
    await u.clear(screen.getByLabelText('From time'));
    await u.type(screen.getByLabelText('From time'), '14:00');
    await u.type(screen.getByLabelText('Reason (optional)'), 'Appointment');
    await u.click(screen.getByRole('button', { name: 'Add time off' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Time off added.'));
    expect(added).toEqual({
      staffId: ids.ravi,
      body: {
        startAt: new Date(`${today}T14:00:00+05:30`).toISOString(),
        endAt: new Date(`${today}T18:00:00+05:30`).toISOString(),
        reason: 'Appointment',
      },
    });

    await u.click(screen.getByRole('button', { name: /^Remove time off from/ }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('a stylist cannot force over bookings: told to ask the front desk', async () => {
    asStylist();
    server.use(
      http.get(api('/staff/:id/time-off'), () => HttpResponse.json([])),
      http.post(api('/staff/:id/time-off'), () => problem(422, 'ACTIVE_BOOKINGS_EXIST')),
    );
    renderWithProviders(<TimeOffPage />);
    expect(await screen.findByText('No time off planned')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Add time off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask the front desk');
  });

  it('checks the end is after the start; explains a missing stylist profile', async () => {
    asStylist();
    server.use(http.get(api('/staff/:id/time-off'), () => HttpResponse.json([])));
    const view = renderWithProviders(<TimeOffPage />);
    const u = user();
    await u.clear(await screen.findByLabelText('To time'));
    await u.type(screen.getByLabelText('To time'), '08:00');
    await u.click(screen.getByRole('button', { name: 'Add time off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The end must be after the start.');
    view.unmount();

    signedInAs(makeUser({ role: 'STAFF' }));
    renderWithProviders(<TimeOffPage />);
    expect(await screen.findByText(/isn't linked to a stylist profile/)).toBeInTheDocument();
  });
});
