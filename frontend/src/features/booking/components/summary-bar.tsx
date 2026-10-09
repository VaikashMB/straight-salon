import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { Service } from '../api';
import { totals } from './step-services';

/**
 * How the bar behaves from `sm` up (on phones it is always pinned to the bottom):
 * - `sticky`: a floating card that stays in view while the list scrolls (services step);
 * - `inline`: only the action, in the page flow where it is rendered (the page already shows
 *   the totals, e.g. the review summary);
 * - `mobile`: not shown at all (larger screens have room for the totals elsewhere).
 */
export type SummaryBarLayout = 'sticky' | 'inline' | 'mobile';

const LAYOUT: Record<SummaryBarLayout, { bar: string; row: string; totals: string }> = {
  sticky: {
    bar: 'sm:sticky sm:bottom-6 sm:rounded-2xl sm:border sm:bg-card/90',
    row: 'sm:px-5',
    totals: '',
  },
  inline: {
    bar: 'sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:shadow-none sm:backdrop-blur-none',
    row: 'sm:justify-end sm:p-0',
    totals: 'sm:hidden',
  },
  mobile: { bar: 'sm:hidden', row: '', totals: '' },
};

// The wizard's running total and the step's primary action (05 §4.1). On phones it is pinned
// to the bottom of the screen, within thumb reach and above the home indicator. The action is
// rendered once, here, and only moved by CSS, so assistive tech always finds exactly one button.
export function SummaryBar({
  services,
  action,
  layout,
}: Readonly<{ services: Service[]; action?: ReactNode; layout: SummaryBarLayout }>) {
  const sum = totals(services);
  const style = LAYOUT[layout];
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 animate-fade-in border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-lift backdrop-blur-md sm:pb-0',
        style.bar,
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3',
          style.row,
        )}
      >
        <p className={cn('grid text-sm leading-tight', style.totals)} aria-live="polite">
          <span className="font-semibold">
            {services.length} {services.length === 1 ? 'service' : 'services'}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatMinutes(sum.durationMin)} · {formatMoney(sum.priceMinor, sum.currency)}
          </span>
        </p>
        {action}
      </div>
    </div>
  );
}
