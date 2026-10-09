'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, CalendarDays, CircleCheck, Clock, UserX } from 'lucide-react';
import Link from 'next/link';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_EDGE, STATUS_LABEL, STATUS_TINT } from '@/features/booking/status';
import { nowOffset, salonWindow } from '@/features/admin-calendar/layout';
import { unwrap, type Schemas } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatCalendarDate, formatMoney, formatTime } from '@/lib/format';
import { usePublicSettings, type PublicSettings } from '@/lib/settings';
import { minutesInZone, minutesToHhmm } from '@/lib/time';
import { cn } from '@/lib/utils';

type Dashboard = Schemas['Dashboard'];

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
        eyebrow="Front desk"
        title="Today"
        description={formatCalendarDate(d.date)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/admin/calendar">
                <CalendarDays aria-hidden />
                Calendar
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/bookings">
                Bookings
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </>
        }
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Today's bookings" value={d.totals.bookings} icon={CalendarDays} />
        <KpiCard label="Completed" value={d.counts.COMPLETED} icon={CircleCheck} delay={60} />
        <KpiCard label="No-shows" value={d.counts.NO_SHOW} icon={UserX} delay={120} />
        <KpiCard
          label="Revenue so far"
          value={formatMoney(d.totals.revenue.amountMinor, d.totals.revenue.currency)}
          icon={Banknote}
          delay={180}
        />
      </dl>
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <Timelines dashboard={d} settings={settings} now={dashboard.dataUpdatedAt} />
        <ComingUp dashboard={d} timeZone={settings.timezone} now={dashboard.dataUpdatedAt} />
      </div>
    </section>
  );
}

function Timelines({
  dashboard,
  settings,
  now,
}: {
  dashboard: Dashboard;
  settings: PublicSettings;
  now: number;
}) {
  const tz = settings.timezone;
  const window = salonWindow(settings, dashboard.date) ?? { open: 9 * 60, close: 21 * 60 };
  const length = window.close - window.open;
  const pct = (minutes: number) =>
    `${Math.min(100, Math.max(0, ((minutes - window.open) / length) * 100))}%`;
  const nowAt = nowOffset(window, dashboard.date, tz, new Date(now));
  // Hour ticks every 3 hours from the first full hour (decorative scale under the bars).
  const ticks: number[] = [];
  for (let m = Math.ceil(window.open / 60) * 60; m <= window.close; m += 180) ticks.push(m);
  return (
    <section
      aria-labelledby="by-stylist"
      className="grid animate-fade-up content-start gap-4 rounded-2xl border bg-card p-5 shadow-soft [animation-delay:120ms]"
    >
      <h2 id="by-stylist" className="text-lg font-semibold">
        By stylist
      </h2>
      {dashboard.staff.length === 0 ? (
        <EmptyState title="No stylists working today" illustration="calendar" />
      ) : (
        <>
          <ul className="grid gap-4">
            {dashboard.staff.map((s) => (
              <li key={s.staffId} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{s.displayName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {s.bookings.length} bookings
                  </span>
                </div>
                <div className="relative h-9 rounded-lg bg-muted/70 ring-1 ring-border/60 ring-inset">
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
                          'absolute inset-y-1.5 rounded-md border border-l-4 border-border/70 shadow-xs transition-shadow outline-none hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          STATUS_TINT[b.status],
                          STATUS_EDGE[b.status],
                        )}
                        style={{
                          left: pct(start),
                          width: `max(0.5rem, calc(${pct(end)} - ${pct(start)}))`,
                        }}
                      />
                    );
                  })}
                  {nowAt !== null ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -inset-y-1 w-0.5 rounded-full bg-destructive"
                      style={{ left: pct(window.open + nowAt) }}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div
            aria-hidden
            className="relative h-4 text-[0.65rem] text-muted-foreground tabular-nums"
          >
            {ticks.map((m) => (
              <span key={m} className="absolute -translate-x-1/2" style={{ left: pct(m) }}>
                {minutesToHhmm(m)}
              </span>
            ))}
          </div>
        </>
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
    <section
      aria-labelledby="coming-up"
      className="grid animate-fade-up content-start gap-4 rounded-2xl border bg-card p-5 shadow-soft [animation-delay:180ms]"
    >
      <h2 id="coming-up" className="flex items-center gap-2 text-lg font-semibold">
        <Clock aria-hidden className="size-4 text-accent" />
        Next 2 hours
      </h2>
      {soon.length === 0 ? (
        <EmptyState title="Nothing due in the next 2 hours" illustration="calendar" />
      ) : (
        <ul className="grid gap-2">
          {soon.map((b) => (
            <li key={b.id}>
              <Link
                href={`/admin/bookings/${b.id}`}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border border-l-4 bg-background/60 p-3 text-sm transition-colors outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  STATUS_EDGE[b.status],
                )}
              >
                <span className="min-w-0">
                  <span className="font-semibold tabular-nums">
                    {formatTime(b.startAt, timeZone)}
                  </span>{' '}
                  {b.customerName}
                  <span className="block truncate text-xs text-muted-foreground">
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
