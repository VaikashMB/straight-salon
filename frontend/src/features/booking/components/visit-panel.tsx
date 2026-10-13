import { Sparkles, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { Service } from '../api';
import { MAX_SERVICES } from '../params';
import { totals } from './step-services';

// "Your visit" on the services step (05 §4.1). One element that CSS moves around, so the
// running total and the Continue button exist exactly once for assistive tech:
// - phones: the bar pinned to the bottom of the screen (hidden until something is chosen);
// - tablets: the same bar, floating and sticky under the list;
// - desktops: a sticky card beside the list with each chosen service (removable), the totals
//   and Continue, or a short prompt while nothing is chosen.
export function VisitPanel({
  services,
  onRemove,
  action,
}: Readonly<{ services: Service[]; onRemove: (serviceId: string) => void; action: ReactNode }>) {
  const sum = totals(services);
  const empty = services.length === 0;
  return (
    <aside
      aria-label="Your visit"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 animate-fade-in border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-lift backdrop-blur-md',
        'sm:sticky sm:bottom-6 sm:rounded-2xl sm:border sm:bg-card/90 sm:pb-0',
        'lg:top-28 lg:bottom-auto lg:self-start lg:overflow-hidden lg:rounded-3xl lg:bg-card lg:backdrop-blur-none',
        empty && 'hidden lg:block',
      )}
    >
      <div className="hidden gap-4 bg-hero p-6 pb-5 lg:grid">
        <div className="grid gap-1">
          <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
            Your visit
          </p>
          <p className="font-serif text-2xl leading-tight tracking-tight">
            {empty ? 'Nothing chosen yet' : 'Looking good.'}
          </p>
        </div>
        {empty ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            Pick one or more services. You can combine up to {MAX_SERVICES} in one visit.
          </p>
        ) : (
          <ul className="grid gap-2">
            {services.map((service) => (
              <li
                key={service.id}
                className="flex animate-fade-in items-center gap-3 rounded-xl border bg-card/80 py-2 pr-1.5 pl-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{service.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatMoney(service.price.amountMinor, service.price.currency)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(service.id)}
                  className="grid size-7 shrink-0 place-content-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <X aria-hidden className="size-3.5" />
                  <span className="sr-only">Remove {service.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {empty ? null : (
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-5 lg:grid lg:items-stretch lg:justify-normal lg:gap-4 lg:border-t lg:p-6 lg:[&>button]:w-full">
          <p
            className="grid text-sm leading-tight lg:flex lg:items-baseline lg:justify-between"
            aria-live="polite"
          >
            <span className="font-semibold">
              {services.length} {services.length === 1 ? 'service' : 'services'}
            </span>
            <span className="text-muted-foreground tabular-nums lg:text-base lg:font-semibold lg:text-foreground">
              {formatMinutes(sum.durationMin)} · {formatMoney(sum.priceMinor, sum.currency)}
            </span>
          </p>
          {action}
        </div>
      )}
    </aside>
  );
}
