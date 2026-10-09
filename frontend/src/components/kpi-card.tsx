import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile } from '@/components/icon-tile';
import { cn } from '@/lib/utils';

const SPARK_W = 96;
const SPARK_H = 28;

// SVG polyline points for a sparkline of `values` in a width × height box (2px inset so the
// stroke isn't clipped). Null with fewer than two values: one point is not a trend.
export function sparklinePoints(
  values: readonly number[],
  width = SPARK_W,
  height = SPARK_H,
): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  return values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - 2 * pad);
      // A flat series sits in the middle rather than on the floor.
      const y = max === min ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad);
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

const round = (n: number) => Math.round(n * 10) / 10;

export interface KpiTrend {
  values: readonly number[];
  // The trend in words (the sparkline itself is decorative), e.g. "Up 12% in the second half".
  label: string;
}

// One figure in a dl of KPIs: label (dt), value and optional hint/trend (dd). The icon tile
// and the sparkline are decorative; their meaning is in the text.
export function KpiCard({
  label,
  value,
  hint,
  icon,
  trend,
  delay = 0,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  trend?: KpiTrend;
  delay?: number; // ms, staggers the entrance animation
  className?: string;
}) {
  const points = trend ? sparklinePoints(trend.values) : null;
  return (
    <div
      className={cn(
        'group grid animate-fade-up content-start gap-1 rounded-2xl border bg-card p-4 shadow-soft transition-shadow duration-300 hover:shadow-lift sm:p-5',
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <dt className="flex items-start justify-between gap-3 text-sm font-medium text-muted-foreground">
        {label}
        {icon ? <IconTile icon={icon} size="sm" className="-mt-0.5" /> : null}
      </dt>
      <dd className="font-heading text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
        {value}
      </dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
      {trend && points ? (
        <dd className="mt-1 flex items-end justify-between gap-2">
          <span className="text-xs text-muted-foreground">{trend.label}</span>
          <svg
            aria-hidden
            data-testid="sparkline"
            width={SPARK_W}
            height={SPARK_H}
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            className="h-7 w-24 shrink-0 overflow-visible"
          >
            <polyline
              points={points}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </dd>
      ) : null}
    </div>
  );
}

// The direction of a daily series in words: the second half of the range against the first.
export function describeTrend(values: readonly number[]): string | null {
  if (values.length < 2) return null;
  const mid = Math.floor(values.length / 2);
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const first = sum(values.slice(0, mid)) / mid;
  const second = sum(values.slice(values.length - mid)) / mid;
  if (first === second) return 'Steady across the range';
  if (first === 0) return 'Up in the second half';
  const change = Math.round(((second - first) / Math.abs(first)) * 100);
  if (change === 0) return 'Steady across the range';
  return change > 0
    ? `Up ${change}% in the second half`
    : `Down ${Math.abs(change)}% in the second half`;
}
