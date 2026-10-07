import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import AuditPage from '@/app/(admin)/admin/audit/page';
import NotificationsPage from '@/app/(admin)/admin/notifications/page';
import ReportsPage from '@/app/(admin)/admin/reports/page';
import ReviewsPage from '@/app/(admin)/admin/reviews/page';
import SettingsPage from '@/app/(admin)/admin/settings/page';
import { rangeProblem } from '@/features/reports/reports-page';
import { todayInZone } from '@/lib/time';
import { api, makeUser, problem, server, settings, signedInAs } from '../../helpers/api';
import { makeReview, page, stylists } from '../../helpers/fixtures';
import { renderWithProviders } from '../../helpers/render';

const user = () => userEvent.setup();
const admin = () => signedInAs(makeUser({ role: 'ADMIN' }));
const today = todayInZone('Asia/Kolkata');
const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' });

describe('review moderation (FR-062, API-061/062)', () => {
  it('hides with a reason and unhides', async () => {
    admin();
    const patches: unknown[] = [];
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(api('/staff'), () => HttpResponse.json(stylists)),
      http.get(api('/reviews'), ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([
            makeReview(),
            makeReview({
              id: 'r2',
              rating: 1,
              comment: 'Rude words',
              isHidden: true,
              hiddenReason: 'Abusive',
              customer: { name: 'Bob Smith' },
            }),
          ]),
        );
      }),
      http.patch(api('/reviews/:id'), async ({ request }) => {
        const body = (await request.json()) as { isHidden: boolean };
        patches.push(body);
        return HttpResponse.json(makeReview({ isHidden: body.isHidden }));
      }),
    );
    renderWithProviders(<ReviewsPage />);
    const u = user();
    expect(await screen.findByText('Hidden: Abusive')).toBeInTheDocument();
    expect(queries[0]?.get('includeHidden')).toBe('true');
    await u.click(screen.getByRole('button', { name: 'Hide' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hide this review?' });
    await u.click(within(dialog).getByRole('button', { name: 'Hide review' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason');
    await u.type(within(dialog).getByLabelText('Reason'), 'Spam');
    await u.click(within(dialog).getByRole('button', { name: 'Hide review' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Review hidden.'));
    await u.click(screen.getByRole('button', { name: 'Unhide' }));
    await waitFor(() =>
      expect(patches).toEqual([{ isHidden: true, hiddenReason: 'Spam' }, { isHidden: false }]),
    );
    await u.selectOptions(screen.getByLabelText('Stylist'), 'Ravi');
    await waitFor(() => expect(queries.at(-1)?.get('staffId')).toBe(stylists[0]!.id));
  });

  it('empty list', async () => {
    admin();
    server.use(
      http.get(api('/staff'), () => HttpResponse.json([])),
      http.get(api('/reviews'), () => HttpResponse.json(page([]))),
    );
    renderWithProviders(<ReviewsPage />);
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
  });
});

describe('notifications viewer (API-066)', () => {
  it('filters and expands a message', async () => {
    admin();
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(api('/notifications'), ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([
            {
              id: 'n1',
              userId: 'u1',
              channel: 'EMAIL',
              template: 'booking_confirmed',
              to: 'a***@example.com',
              status: 'FAILED',
              attempts: 5,
              createdAt: '2026-10-06T09:12:44.000Z',
              content: { subject: 'Your booking is confirmed', text: 'See you on Monday.' },
              provider: 'smtp',
              error: 'ECONNREFUSED',
            },
          ]),
        );
      }),
    );
    renderWithProviders(<NotificationsPage />);
    const u = user();
    await u.click(await screen.findByText('booking confirmed'));
    expect(screen.getByText('Your booking is confirmed')).toBeInTheDocument();
    expect(screen.getByText('Error: ECONNREFUSED')).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Channel'), 'SMS');
    await u.selectOptions(screen.getByLabelText('Status'), 'Failed');
    await u.selectOptions(screen.getByLabelText('Template'), 'password reset');
    await waitFor(() =>
      expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({
        channel: 'SMS',
        status: 'FAILED',
        template: 'password_reset',
        page: '1',
      }),
    );
  });

  it('empty and failing', async () => {
    admin();
    server.use(http.get(api('/notifications'), () => HttpResponse.json(page([]))));
    const view = renderWithProviders(<NotificationsPage />);
    expect(await screen.findByText('No notifications match')).toBeInTheDocument();
    view.unmount();
    server.use(http.get(api('/notifications'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<NotificationsPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('audit log (FR-073, API-073)', () => {
  it('filters (sending only well-formed ids) and expands before/after', async () => {
    admin();
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(api('/audit-logs'), ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          page([
            {
              id: 'a1',
              at: '2026-10-06T09:12:44.123Z',
              actor: { id: '6712c0f9a1b2c3d4e5f60222', role: 'RECEPTIONIST' },
              action: 'booking.cancel',
              entityType: 'booking',
              entityId: '6712c0f9a1b2c3d4e5f60789',
              before: { status: 'BOOKED' },
              after: { status: 'CANCELLED' },
              diff: ['status'],
              requestId: 'req-9',
              metadata: { override: true },
            },
          ]),
        );
      }),
    );
    renderWithProviders(<AuditPage />);
    const u = user();
    await u.click(await screen.findByText('booking.cancel'));
    expect(screen.getByText(/Changed: status/)).toBeInTheDocument();
    expect(screen.getByText(/"CANCELLED"/)).toBeInTheDocument();
    expect(screen.getByText(/"override": true/)).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Entity'), 'booking');
    await u.type(screen.getByLabelText('Entity id'), 'abc');
    await u.type(screen.getByLabelText('Actor id'), 'system');
    await u.type(screen.getByLabelText('Action'), 'booking.cancel');
    await u.type(screen.getByLabelText('From'), '2026-10-01');
    await waitFor(() => {
      const q = Object.fromEntries(queries.at(-1)!);
      expect(q).toMatchObject({
        entityType: 'booking',
        actorId: 'system',
        action: 'booking.cancel',
        from: '2026-10-01',
      });
      expect(q.entityId).toBeUndefined();
    });
  });

  it('empty', async () => {
    admin();
    server.use(http.get(api('/audit-logs'), () => HttpResponse.json(page([]))));
    renderWithProviders(<AuditPage />);
    expect(await screen.findByText('No entries match')).toBeInTheDocument();
  });
});

describe('reports (FR-071/072, US-05, API-071/072)', () => {
  const totals = {
    bookings: 20,
    completed: 15,
    cancelled: 3,
    noShows: 1,
    noShowRate: 0.0588,
    revenue: inr(825_000),
    bookedMinutes: 900,
    availableMinutes: 1200,
    utilisation: 0.75,
  };

  it('KPIs, charts with data tables, and the CSV download', async () => {
    admin();
    const ranges: string[] = [];
    let csvRange = '';
    server.use(
      http.get(api('/reports/summary'), ({ request }) => {
        const q = new URL(request.url).searchParams;
        ranges.push(`${q.get('from')}..${q.get('to')}`);
        return HttpResponse.json({
          from: q.get('from'),
          to: q.get('to'),
          timezone: 'Asia/Kolkata',
          totals,
          byDay: [{ date: '2026-10-05', ...totals }],
          byService: [{ serviceId: 's1', name: 'Haircut', count: 10, revenue: inr(400_000) }],
          byStaff: [{ staffId: 'st1', displayName: 'Ravi', ...totals }],
        });
      }),
      http.get(api('/reports/summary.csv'), ({ request }) => {
        const q = new URL(request.url).searchParams;
        csvRange = `${q.get('from')}..${q.get('to')}`;
        return new HttpResponse('section,key\r\ntotal,\r\n', {
          headers: { 'content-type': 'text/csv' },
        });
      }),
    );
    renderWithProviders(<ReportsPage />);
    const u = user();
    expect((await screen.findAllByText('₹8,250.00')).length).toBeGreaterThan(0);
    expect(ranges[0]).toBe(`${today.slice(0, 8)}01..${today}`);
    expect(screen.getByText('5.9%')).toBeInTheDocument();
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);
    expect(screen.getByRole('figure', { name: 'Revenue over time' })).toBeInTheDocument();
    await u.click(
      within(screen.getByRole('figure', { name: 'Revenue by service' })).getByText('Show data'),
    );
    expect(screen.getByRole('rowheader', { name: 'Haircut' })).toBeInTheDocument();

    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await u.click(screen.getByRole('button', { name: /Download CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(csvRange).toBe(ranges[0]);
  });

  it('validates the range before asking the API', async () => {
    admin();
    server.use(http.get(api('/reports/summary'), () => problem(500, 'INTERNAL_ERROR')));
    renderWithProviders(<ReportsPage />);
    const u = user();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await u.clear(screen.getByLabelText('From'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose both dates.');
    expect(screen.getByRole('button', { name: /Download CSV/ })).toBeDisabled();
    expect(rangeProblem('2026-10-10', '2026-10-01')).toMatch(/on or before/);
    expect(rangeProblem('2025-01-01', '2026-10-01')).toMatch(/at most 366 days/);
    expect(rangeProblem('2026-01-01', '2026-12-31')).toBeNull();
  });
});

describe('settings (FR-080, API-017/018) and holidays (FR-022, API-019/020)', () => {
  const full = {
    ...settings,
    bufferMin: 0,
    noShowGraceMin: 30,
    reviewWindowDays: 14,
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  function settingsApi() {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    server.use(
      http.get(api('/settings'), () => HttpResponse.json(full)),
      http.put(api('/settings'), async ({ request }) => {
        const body = await request.json();
        calls.push({ method: 'PUT', path: 'settings', body });
        return HttpResponse.json({ ...full, updatedAt: '2026-10-07T00:00:00.000Z' });
      }),
      http.get(api('/holidays'), () =>
        HttpResponse.json([{ id: 'h1', date: '2026-11-08', name: 'Diwali' }]),
      ),
      http.post(api('/holidays'), async ({ request }) => {
        const body = (await request.json()) as { force?: boolean };
        calls.push({ method: 'POST', path: 'holidays', body });
        return body.force
          ? HttpResponse.json({ id: 'h2', date: '2026-12-25', name: 'Christmas' }, { status: 201 })
          : problem(422, 'ACTIVE_BOOKINGS_EXIST');
      }),
      http.delete(api('/holidays/:id'), () => {
        calls.push({ method: 'DELETE', path: 'holidays' });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return calls;
  }

  it('saves every field including business hours', async () => {
    admin();
    const calls = settingsApi();
    renderWithProviders(<SettingsPage />);
    const u = user();
    const buffer = await screen.findByLabelText('Buffer between bookings (minutes)');
    await u.clear(buffer);
    await u.type(buffer, '10');
    await u.click(screen.getByLabelText('Sunday'));
    await u.clear(screen.getByLabelText('Monday closes'));
    await u.type(screen.getByLabelText('Monday closes'), '08:00');
    await u.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Monday: closing must be after opening')).toBeInTheDocument();
    await u.clear(screen.getByLabelText('Monday closes'));
    await u.type(screen.getByLabelText('Monday closes'), '20:30');
    await u.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings saved.'));
    const body = calls.find((c) => c.method === 'PUT')?.body as Record<string, unknown> & {
      businessHours: { dayOfWeek: number; isOpen: boolean }[];
    };
    expect(body).toMatchObject({
      name: 'Straight Salon',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      bufferMin: 10,
      slotGranularityMin: 15,
      reviewWindowDays: 14,
    });
    expect(body.businessHours.find((h) => h.dayOfWeek === 0)?.isOpen).toBe(false);
    expect(body).not.toHaveProperty('updatedAt');
  });

  it('explains a refused timezone change and a slot size that breaks services', async () => {
    admin();
    settingsApi();
    server.use(http.put(api('/settings'), () => problem(422, 'ACTIVE_BOOKINGS_EXIST')));
    renderWithProviders(<SettingsPage />);
    const u = user();
    await u.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(
      await screen.findByText("The timezone can't change while future bookings exist."),
    ).toBeInTheDocument();
    server.use(http.put(api('/settings'), () => problem(422, 'INVALID_DURATION')));
    await u.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      await screen.findByText('Every service duration must be a multiple of the slot size.'),
    ).toBeInTheDocument();
    await u.clear(screen.getByLabelText('Currency'));
    await u.type(screen.getByLabelText('Currency'), 'rs');
    await u.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Use a 3-letter ISO code like INR')).toBeInTheDocument();
  });

  it('adds a holiday (forcing past bookings after confirming) and removes one', async () => {
    admin();
    const calls = settingsApi();
    renderWithProviders(<SettingsPage />);
    const u = user();
    expect(await screen.findByText(/Diwali/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Add holiday' }));
    expect(await screen.findByText('Enter a date and a name.')).toBeInTheDocument();
    await u.type(screen.getByLabelText('Date'), '2026-12-25');
    await u.type(screen.getByLabelText('Holiday name'), 'Christmas');
    await u.click(screen.getByRole('button', { name: 'Add holiday' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bookings on that day' });
    await u.click(within(dialog).getByRole('button', { name: 'Cancel bookings and close' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Holiday added; bookings on that day were cancelled.',
      ),
    );
    expect(calls.filter((c) => c.path === 'holidays').map((c) => c.body)).toEqual([
      { date: '2026-12-25', name: 'Christmas' },
      { date: '2026-12-25', name: 'Christmas', force: true },
    ]);
    await u.click(screen.getByRole('button', { name: 'Remove Diwali' }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('a duplicate holiday date is explained', async () => {
    admin();
    settingsApi();
    server.use(http.post(api('/holidays'), () => problem(409, 'DUPLICATE')));
    renderWithProviders(<SettingsPage />);
    const u = user();
    await u.type(await screen.findByLabelText('Date'), '2026-11-08');
    await u.type(screen.getByLabelText('Holiday name'), 'Diwali again');
    await u.click(screen.getByRole('button', { name: 'Add holiday' }));
    expect(await screen.findByText('That date is already a holiday.')).toBeInTheDocument();
  });
});

vi.setConfig({ testTimeout: 15_000 });
