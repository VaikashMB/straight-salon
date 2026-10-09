'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Banknote, CalendarDays, CircleCheck, Download, Gauge, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeTrend, KpiCard, type KpiTrend } from '@/components/kpi-card';
import { TextField } from '@/components/form/text-field';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { downloadFile } from '@/features/booking/ics';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { addDays, todayInZone } from '@/lib/time';
import { BarFigure, LineFigure } from './charts';

const MAX_DAYS = 366; // API-071

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

// A KPI's daily series as a sparkline with its direction in words; none for a single day.
function trendOf(values: number[]): KpiTrend | undefined {
  const label = describeTrend(values);
  return label ? { values, label } : undefined;
}

// Why a range can't be requested, or null.
export function rangeProblem(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both dates.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (addDays(from, MAX_DAYS - 1) < to) return `Choose at most ${MAX_DAYS} days.`;
  return null;
}

// Reports (FR-071/072, US-05, API-071/072): KPI cards, revenue over time, revenue by service,
// utilisation by stylist, and the same data as CSV. Dates are appointment dates.
export function ReportsPage() {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading reports" />;
  return <Reports timeZone={settings.timezone} />;
}

function Reports({ timeZone }: { timeZone: string }) {
  const { api } = useAuth();
  const today = todayInZone(timeZone);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const problem = rangeProblem(from, to);

  const summary = useQuery({
    queryKey: ['reports', 'summary', from, to],
    queryFn: () => unwrap(api.GET('/api/v1/reports/summary', { params: { query: { from, to } } })),
    enabled: problem === null,
    placeholderData: keepPreviousData,
  });

  const csv = useMutation({
    mutationFn: () =>
      unwrap(
        api.GET('/api/v1/reports/summary.csv', {
          params: { query: { from, to } },
          parseAs: 'blob',
        }),
      ),
    onSuccess: (blob) => downloadFile(`straight-salon-report-${from}-to-${to}.csv`, blob),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const data = summary.data;
  const money = (minor: number) => formatMoney(minor, data?.totals.revenue.currency ?? 'INR');

  const renderReport = () => {
    if (problem)
      return (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      );
    if (summary.isPending) return <LoadingList rows={3} label="Loading report" />;
    if (summary.error)
      return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
    if (data)
      return (
        <>
          <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Revenue"
              value={money(data.totals.revenue.amountMinor)}
              icon={Banknote}
              trend={trendOf(data.byDay.map((d) => d.revenue.amountMinor))}
            />
            <KpiCard
              label="Bookings"
              value={data.totals.bookings}
              icon={CalendarDays}
              trend={trendOf(data.byDay.map((d) => d.bookings))}
              delay={60}
            />
            <KpiCard
              label="Completed"
              value={data.totals.completed}
              icon={CircleCheck}
              trend={trendOf(data.byDay.map((d) => d.completed))}
              delay={120}
            />
            <KpiCard
              label="Cancellations"
              value={data.totals.cancelled}
              icon={Ban}
              trend={trendOf(data.byDay.map((d) => d.cancelled))}
              delay={180}
            />
            <KpiCard
              label="No-show rate"
              value={percent(data.totals.noShowRate)}
              hint={`${data.totals.noShows} no-shows`}
              icon={UserX}
              trend={trendOf(data.byDay.map((d) => d.noShowRate))}
              delay={240}
            />
            <KpiCard
              label="Utilisation"
              value={percent(data.totals.utilisation)}
              hint="Booked ÷ available time"
              icon={Gauge}
              trend={trendOf(data.byDay.map((d) => d.utilisation))}
              delay={300}
            />
          </dl>
          <LineFigure
            title="Revenue over time"
            format={money}
            points={data.byDay.map((d) => ({
              label: formatCalendarDate(d.date).slice(4, 10),
              value: d.revenue.amountMinor,
            }))}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <BarFigure
              title="Revenue by service"
              format={money}
              points={data.byService.map((s) => ({ label: s.name, value: s.revenue.amountMinor }))}
            />
            <BarFigure
              title="Utilisation by stylist"
              format={percent}
              points={data.byStaff.map((s) => ({ label: s.displayName, value: s.utilisation }))}
            />
          </div>
        </>
      );
    return null;
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Totals by appointment date. Revenue counts payments recorded for completed bookings."
        actions={
          <Button
            variant="outline"
            disabled={problem !== null || csv.isPending}
            onClick={() => csv.mutate()}
          >
            <Download aria-hidden /> Download CSV
          </Button>
        }
      />
      <div className="grid max-w-md animate-fade-up gap-3 rounded-2xl border bg-card p-4 shadow-soft [animation-delay:60ms] sm:grid-cols-2">
        <TextField
          label="From"
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {renderReport()}
    </section>
  );
}
