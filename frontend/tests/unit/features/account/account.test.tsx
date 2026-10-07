import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it } from 'vitest';
import BookingPage from '@/app/(customer)/account/bookings/[id]/page';
import HistoryPage from '@/app/(customer)/account/history/page';
import AccountPage from '@/app/(customer)/account/page';
import ProfilePage from '@/app/(customer)/account/profile/page';
import { addDays, todayInZone } from '@/lib/time';
import { api, makeUser, problem, server, signedInAs } from '../../helpers/api';
import { ids, makeBooking, page, stylists } from '../../helpers/fixtures';
import { router } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

const user = () => userEvent.setup();
const tomorrow = addDays(todayInZone('Asia/Kolkata'), 1);

function myBookings(upcoming = [makeBooking()], past = [makeBooking({ status: 'COMPLETED' })]) {
  const scopes: string[] = [];
  server.use(
    http.get(api('/bookings/me'), ({ request }) => {
      const query = new URL(request.url).searchParams;
      scopes.push(`${query.get('scope')}:${query.get('page')}`);
      const list = query.get('scope') === 'past' ? past : upcoming;
      return HttpResponse.json(
        page(list, { pageSize: 10, totalPages: query.get('scope') === 'past' ? 2 : 1 }),
      );
    }),
  );
  return scopes;
}

describe('customer account (05 §4.2)', () => {
  it('upcoming: status badges and API-driven Cancel/Reschedule', async () => {
    signedInAs(makeUser());
    myBookings([
      makeBooking(),
      makeBooking({
        id: '6712c0f9a1b2c3d4e5f60790',
        bookingRef: 'SS-2',
        canCancel: false,
        canReschedule: false,
      }),
    ]);
    renderWithProviders(<AccountPage />);
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('Booked')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    // Inside the cut-off: visible but disabled, with the reason (US-02).
    const blocked = within(cards[1]!).getByRole('button', { name: 'Cancel' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).toHaveAccessibleDescription(
      /Online changes close 2 hours before the appointment/,
    );
    await user().click(blocked);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels with an optional reason (API-055, FR-035)', async () => {
    signedInAs(makeUser());
    myBookings();
    let body: unknown = null;
    server.use(
      http.post(api('/bookings/:id/cancel'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBooking({ status: 'CANCELLED' }));
      }),
    );
    renderWithProviders(<AccountPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this booking?' });
    await u.type(within(dialog).getByLabelText('Reason (optional)'), 'Travelling');
    await u.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Booking SS-261012-7KQ2 cancelled.'),
    );
    expect(body).toEqual({ reason: 'Travelling' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a failed cancel keeps the dialog open with the reason', async () => {
    signedInAs(makeUser());
    myBookings();
    server.use(http.post(api('/bookings/:id/cancel'), () => problem(422, 'CUTOFF_PASSED')));
    renderWithProviders(<AccountPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Cancel' }));
    await u.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'too close to the appointment',
    );
  });

  it('reschedules with the wizard’s date & time step (API-054, BR-015)', async () => {
    signedInAs(makeUser());
    myBookings();
    let body: unknown = null;
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/availability/days'), () =>
        HttpResponse.json({
          from: tomorrow,
          to: tomorrow,
          timezone: 'Asia/Kolkata',
          availableDates: [tomorrow],
        }),
      ),
      http.get(api('/availability'), () =>
        HttpResponse.json({
          date: tomorrow,
          timezone: 'Asia/Kolkata',
          slots: [{ startAt: `${tomorrow}T09:30:00.000Z`, staffIds: [ids.ravi] }],
        }),
      ),
      http.post(api('/bookings/:id/reschedule'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeBooking({ startAt: `${tomorrow}T09:30:00.000Z` }));
      }),
    );
    renderWithProviders(<AccountPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Pick a time' })).toBeDisabled();
    await u.click(await within(dialog).findByRole('button', { name: /^15:00/ }));
    await u.click(within(dialog).getByRole('button', { name: /^Move to/ }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Moved to /)),
    );
    expect(body).toEqual({ startAt: `${tomorrow}T09:30:00.000Z` });
  });

  it('a taken slot on reschedule asks for another time', async () => {
    signedInAs(makeUser());
    myBookings();
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/availability/days'), () =>
        HttpResponse.json({
          from: tomorrow,
          to: tomorrow,
          timezone: 'Asia/Kolkata',
          availableDates: [tomorrow],
        }),
      ),
      http.get(api('/availability'), () =>
        HttpResponse.json({
          date: tomorrow,
          timezone: 'Asia/Kolkata',
          slots: [{ startAt: `${tomorrow}T09:30:00.000Z`, staffIds: [ids.ravi] }],
        }),
      ),
      http.post(api('/bookings/:id/reschedule'), () => problem(409, 'SLOT_UNAVAILABLE')),
    );
    renderWithProviders(<AccountPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('dialog');
    await u.click(await within(dialog).findByRole('button', { name: /^15:00/ }));
    await u.click(within(dialog).getByRole('button', { name: /^Move to/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no longer available');
    expect(within(dialog).getByRole('button', { name: 'Pick a time' })).toBeDisabled();
  });

  it('empty and failing lists offer an action', async () => {
    signedInAs(makeUser());
    myBookings([]);
    const view = renderWithProviders(<AccountPage />);
    expect(await screen.findByText('No upcoming bookings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book an appointment' })).toHaveAttribute(
      'href',
      '/book',
    );
    view.unmount();

    server.use(http.get(api('/bookings/me'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<AccountPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('history: past bookings, paginated, with "Leave a review" when eligible', async () => {
    signedInAs(makeUser());
    const scopes = myBookings(
      [],
      [
        makeBooking({
          status: 'COMPLETED',
          canCancel: false,
          canReschedule: false,
          canReview: true,
        }),
      ],
    );
    renderWithProviders(<HistoryPage />);
    expect(await screen.findByRole('heading', { name: 'Booking history' })).toBeInTheDocument();
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leave a review' })).toHaveAttribute(
      'href',
      `/account/bookings/${ids.booking}#review`,
    );
    await user().click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(scopes).toContain('past:2'));
  });

  it('detail: services, notes, cancellation and a review form (API-053, API-060)', async () => {
    signedInAs(makeUser());
    let review: unknown = null;
    server.use(
      http.get(api('/bookings/:id'), () =>
        HttpResponse.json(
          makeBooking({
            status: 'COMPLETED',
            canCancel: false,
            canReschedule: false,
            canReview: true,
            notes: 'Short on top',
            payment: { status: 'PAID' },
          }),
        ),
      ),
      http.post(api('/bookings/:id/review'), async ({ request }) => {
        review = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderWithProviders(await BookingPage({ params: Promise.resolve({ id: ids.booking }) }));
    expect(await screen.findByText('Reference SS-261012-7KQ2')).toBeInTheDocument();
    expect(screen.getByText('Short on top')).toBeInTheDocument();
    expect(screen.getByText(/₹550\.00 · Paid/)).toBeInTheDocument();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(await screen.findByText('Choose a rating from 1 to 5 stars.')).toBeInTheDocument();
    await u.click(screen.getByLabelText('4 stars'));
    await u.type(screen.getByLabelText('Comment (optional)'), 'Lovely');
    await u.click(screen.getByRole('button', { name: 'Submit review' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Thanks for your review!'));
    expect(review).toEqual({ rating: 4, comment: 'Lovely' });
  });

  it('detail: a review refused by the API shows why; cancelled bookings show the reason', async () => {
    signedInAs(makeUser());
    server.use(
      http.get(api('/bookings/:id'), () =>
        HttpResponse.json(
          makeBooking({
            status: 'CANCELLED',
            canReview: true,
            cancellation: { at: '2026-10-11T05:30:00.000Z', reason: 'Unwell', overridden: false },
          }),
        ),
      ),
      http.post(api('/bookings/:id/review'), () => problem(422, 'REVIEW_NOT_ALLOWED')),
    );
    renderWithProviders(await BookingPage({ params: Promise.resolve({ id: ids.booking }) }));
    expect(await screen.findByText(/Unwell/)).toBeInTheDocument();
    const u = user();
    await u.click(screen.getByLabelText('5 stars'));
    await u.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('can no longer be reviewed');
  });

  it('detail: other customers’ bookings are simply not found (06 §3)', async () => {
    signedInAs(makeUser());
    server.use(http.get(api('/bookings/:id'), () => problem(404, 'NOT_FOUND')));
    const view = renderWithProviders(
      await BookingPage({ params: Promise.resolve({ id: ids.booking }) }),
    );
    expect(await screen.findByRole('heading', { name: 'Booking not found' })).toBeInTheDocument();
    view.unmount();
    server.use(http.get(api('/bookings/:id'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(await BookingPage({ params: Promise.resolve({ id: ids.booking }) }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('profile (FR-005, API-010, API-008, API-005)', () => {
  it('saves name, phone and preferences, normalising the phone', async () => {
    signedInAs(makeUser());
    let body: unknown = null;
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.patch(api('/users/me'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeUser({ name: 'Ananya R' }));
      }),
    );
    renderWithProviders(<ProfilePage />);
    const u = user();
    const name = await screen.findByLabelText('Full name');
    await u.clear(name);
    await u.type(name, 'Ananya R');
    const phone = screen.getByLabelText('Mobile number');
    await u.clear(phone);
    await u.type(phone, '098765 43210');
    await u.selectOptions(
      screen.getByLabelText('Preferred stylist'),
      await screen.findByRole('option', { name: 'Ravi' }),
    );
    await u.click(screen.getByLabelText('Text me reminders (SMS)'));
    await u.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Your profile has been saved.'));
    expect(body).toEqual({
      name: 'Ananya R',
      phone: '+919876543210',
      preferences: { smsOptIn: false, emailOptIn: true, preferredStaffId: ids.ravi },
    });
  });

  it('a phone that belongs to someone else is flagged on the field', async () => {
    signedInAs(makeUser());
    server.use(
      http.get(api('/staff'), () => HttpResponse.json([])),
      http.patch(api('/users/me'), () => problem(409, 'DUPLICATE')),
    );
    renderWithProviders(<ProfilePage />);
    await user().click(await screen.findByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('This number belongs to another account.')).toBeInTheDocument();
  });

  it('changes the password; a wrong current password is shown on its field', async () => {
    signedInAs(makeUser());
    let calls = 0;
    server.use(
      http.get(api('/staff'), () => HttpResponse.json([])),
      http.post(api('/auth/change-password'), () => {
        calls += 1;
        return calls === 1
          ? problem(400, 'VALIDATION_FAILED', {
              errors: [{ path: 'currentPassword', message: 'Current password is incorrect' }],
            })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<ProfilePage />);
    const u = user();
    await u.type(await screen.findByLabelText('Current password'), 'Old-pass1');
    await u.type(screen.getByLabelText('New password'), 'New-pass22');
    await u.type(screen.getByLabelText('Confirm new password'), 'New-pass22');
    await u.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Password changed. Other devices have been signed out.',
      ),
    );
  });

  it('validates the new password inline', async () => {
    signedInAs(makeUser());
    server.use(http.get(api('/staff'), () => HttpResponse.json([])));
    renderWithProviders(<ProfilePage />);
    const u = user();
    await u.type(await screen.findByLabelText('Current password'), 'Same-pass1');
    await u.type(screen.getByLabelText('New password'), 'Same-pass1');
    await u.type(screen.getByLabelText('Confirm new password'), 'Other-pass1');
    await u.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText("The passwords don't match")).toBeInTheDocument();
    expect(
      screen.getByText('Choose a password different from your current one'),
    ).toBeInTheDocument();
  });

  it('signs out of all devices, including this one', async () => {
    signedInAs(makeUser());
    let all = false;
    server.use(
      http.get(api('/staff'), () => HttpResponse.json([])),
      http.post(api('/auth/logout-all'), () => {
        all = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(api('/auth/logout'), () => new HttpResponse(null, { status: 204 })),
    );
    renderWithProviders(<ProfilePage />);
    await user().click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(all).toBe(true);
  });

  it('reports a failed sign-out-everywhere', async () => {
    signedInAs(makeUser());
    server.use(
      http.get(api('/staff'), () => HttpResponse.json([])),
      http.post(api('/auth/logout-all'), () => problem(500, 'INTERNAL_ERROR')),
    );
    renderWithProviders(<ProfilePage />);
    await user().click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong (ref: req-123)'),
    );
  });
});
