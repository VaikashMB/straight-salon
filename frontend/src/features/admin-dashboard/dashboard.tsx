'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_LABEL, type BookingStatus } from '@/features/booking/status';
import { salonWindow } from '@/features/admin-calendar/layout';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatCalendarDate, formatMoney, formatTime } from '@/lib/format';
import { usePublicSettings, type PublicSettings } from '@/lib/settings';
import { minutesInZone } from '@/lib/time';
import { cn } from '@/lib/utils';

type Dashboard = Schemas['Dashboard'];

const DOT: Record<BookingStatus, string> = {
  BOOKED: 'bg-sky-600/70',
  CHECKED_IN: 'bg-accent',
  IN_SERVICE: 'bg-warning',
  COMPLETED: 'bg-success',
  CANCELLED: 'bg-muted-foreground',
  NO_SHOW: 'bg-destructive',
};

const SOON_MS = 2 * 60 * 60_000;

// Today at a glance (FR-070, 05 §4.4, API-070): KPI cards, a mini-timeline per stylist and the
// bookings due in the next two hours. Refreshes every minute.
export function AdminDashboard() {
  const { api } = useAuth();
  const { data: settings } = usePublicSettings();
  const dashboard = useQuery({
    queryKey: ['dashboard', 'today'],
    queryFn: () => unwrap(api.GET('/api/v1/reports/dashboard')),
    refetchInterval: 60_000,
  });

  if (dashboard.isPending || !settings) return <LoadingList rows={4} label="Loading dashboard" />;
  if (dashboard.error)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const d = dashboard.data;
  return (
    <section className="grid gap-8">
      <PageHeader
        title="Today"
        description={formatCalendarDate(d.date)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/calendar">Calendar</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/bookings">Bookings</Link>
            </Button>
          </>
        }
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Today's bookings" value={d.totals.bookings} />
        <KpiCard label="Completed" value={d.counts.COMPLETED} />
        <KpiCard label="No-shows" value={d.counts.NO_SHOW} />
        <KpiCard
          label="Revenue so far"
          value={formatMoney(d.totals.revenue.amountMinor, d.totals.revenue.currency)}
        />
      </dl>
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <Timelines dashboard={d} settings={settings} />
        <ComingUp dashboard={d} timeZone={settings.timezone} now={dashboard.dataUpdatedAt} />
      </div>
    </section>
  );
}

function Timelines({ dashboard, settings }: { dashboard: Dashboard; settings: PublicSettings }) {
  const tz = settings.timezone;
  const window = salonWindow(settings, dashboard.date) ?? { open: 9 * 60, close: 21 * 60 };
  const length = window.close - window.open;
  const pct = (minutes: number) =>
    `${Math.min(100, Math.max(0, ((minutes - window.open) / length) * 100))}%`;
  return (
    <section aria-labelledby="by-stylist" className="grid content-start gap-3">
      <h2 id="by-stylist" className="text-lg font-semibold">
        By stylist
      </h2>
      {dashboard.staff.length === 0 ? (
        <EmptyState title="No stylists working today" />
      ) : (
        <ul className="grid gap-3">
          {dashboard.staff.map((s) => (
            <li key={s.staffId} className="grid gap-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{s.displayName}</span>
                <span className="text-muted-foreground">{s.bookings.length} bookings</span>
              </div>
              <div className="relative h-8 rounded-md bg-muted">
                {s.bookings.map((b) => {
                  const start = minutesInZone(b.startAt, tz);
                  const end = minutesInZone(b.endAt, tz);
                  return (
                    <Link
                      key={b.id}
                      href={`/admin/bookings/${b.id}`}
                      title={`${formatTime(b.startAt, tz)} ${b.customerName} · ${STATUS_LABEL[b.status]}`}
                      aria-label={`${formatTime(b.startAt, tz)} ${b.customerName}, ${b.services.join(', ')}, ${STATUS_LABEL[b.status]}`}
                      className={cn(
                        'absolute inset-y-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        DOT[b.status],
                      )}
                      style={{
                        left: pct(start),
                        width: `max(0.4rem, calc(${pct(end)} - ${pct(start)}))`,
                      }}
                    />
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// `now` is when the dashboard was fetched, so the list moves on with each minute's refresh.
function ComingUp({
  dashboard,
  timeZone,
  now,
}: {
  dashboard: Dashboard;
  timeZone: string;
  now: number;
}) {
  const soon = dashboard.staff
    .flatMap((s) => s.bookings.map((b) => ({ ...b, stylist: s.displayName })))
    .filter((b) => {
      const start = new Date(b.startAt).getTime();
      return (
        (b.status === 'BOOKED' || b.status === 'CHECKED_IN') &&
        start >= now - 15 * 60_000 &&
        start <= now + SOON_MS
      );
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  return (
    <section aria-labelledby="coming-up" className="grid content-start gap-3">
      <h2 id="coming-up" className="text-lg font-semibold">
        Next 2 hours
      </h2>
      {soon.length === 0 ? (
        <EmptyState title="Nothing due in the next 2 hours" />
      ) : (
        <ul className="grid gap-2">
          {soon.map((b) => (
            <li key={b.id}>
              <Link
                href={`/admin/bookings/${b.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm hover:bg-secondary"
              >
                <span>
                  <span className="font-medium">{formatTime(b.startAt, timeZone)}</span>{' '}
                  {b.customerName}
                  <span className="block text-xs text-muted-foreground">
                    {b.services.join(', ')} · {b.stylist}
                  </span>
                </span>
                <StatusBadge status={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
