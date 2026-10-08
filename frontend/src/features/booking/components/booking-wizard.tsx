'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { formatMinutes } from '@/lib/time';
import { qualifiedFor, useServices, useStylists, type Service, type Stylist } from '../api';
import {
  ANY,
  effectiveStep,
  MAX_SERVICES,
  parseWizard,
  wizardQuery,
  type Step,
  type WizardState,
} from '../params';
import { DateTimePicker } from './date-time-picker';
import { StepReview } from './step-review';
import { StepServices, totals } from './step-services';
import { StepStylist } from './step-stylist';
import { StepSuccess } from './step-success';
import { WizardProgress } from './wizard-progress';

const TITLES: Record<Step, string> = {
  services: 'Choose your services',
  stylist: 'Choose a stylist',
  time: 'Pick a date and time',
  review: 'Review and confirm',
  done: 'Booking confirmed',
};

const PREVIOUS: Partial<Record<Step, Step>> = {
  stylist: 'services',
  time: 'stylist',
  review: 'time',
};

// Adds or removes a service, keeping at most MAX_SERVICES.
function toggled(serviceIds: string[], id: string): string[] {
  return serviceIds.includes(id)
    ? serviceIds.filter((s) => s !== id)
    : [...serviceIds, id].slice(0, MAX_SERVICES);
}

// The chosen stylist, if they can do every chosen service. One who can't falls back to "any"
// (once the stylists have loaded).
function resolveStylist(
  stylists: Stylist[] | undefined,
  serviceIds: string[],
  chosen: string,
): { stylist: Stylist | null; staff: string } {
  const stylist = qualifiedFor(stylists ?? [], serviceIds).find((s) => s.id === chosen) ?? null;
  if (stylists && chosen !== ANY && !stylist) return { stylist: null, staff: ANY };
  return { stylist, staff: chosen };
}

// The booking wizard (05 §4.1). Every choice lives in the URL: moving between steps pushes a
// history entry (so Back works), changes within a step replace the current one.
export function BookingWizard() {
  const router = useRouter();
  const search = useSearchParams();
  const state = useMemo(() => parseWizard(search), [search]);
  const step = effectiveStep(state);
  const services = useServices();
  const stylists = useStylists();
  const { data: settings } = usePublicSettings();
  const heading = useRef<HTMLHeadingElement>(null);

  const go = useCallback(
    (patch: Partial<WizardState>, mode: 'push' | 'replace' = 'replace') => {
      const href = wizardQuery({ ...state, ...patch });
      if (mode === 'push') router.push(href, { scroll: true });
      else router.replace(href, { scroll: false });
    },
    [router, state],
  );

  // Move focus to the new step's heading, so keyboard and screen-reader users follow along.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const chosen = (services.data ?? []).filter((s) => state.serviceIds.includes(s.id));
  const { stylist, staff } = resolveStylist(stylists.data, state.serviceIds, state.staff);

  const toggleService = (id: string) =>
    go({ serviceIds: toggled(state.serviceIds, id), start: null });

  // The review step waits for the settings, services and stylists it summarises.
  let review: ReactNode = null;
  if (step === 'review' && state.start) {
    review =
      settings && services.data && stylists.data ? (
        <StepReview
          services={chosen}
          stylist={stylist}
          staff={staff}
          start={state.start}
          timeZone={settings.timezone}
          returnTo={wizardQuery({ ...state, step: 'review' })}
          onBooked={(booking) =>
            router.replace(wizardQuery({ step: 'done', bookingId: booking.id }))
          }
          onSlotTaken={() => go({ start: null, step: 'time' }, 'push')}
        />
      ) : (
        <Skeleton className="h-64 w-full" />
      );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 pb-28 sm:py-12">
      {step !== 'done' ? <WizardProgress current={step} /> : null}
      <div className="flex items-center gap-3">
        {PREVIOUS[step] ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => go({ step: PREVIOUS[step] }, 'push')}
          >
            <ArrowLeft aria-hidden />
          </Button>
        ) : null}
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none sm:text-3xl">
          {TITLES[step]}
        </h1>
      </div>

      {step === 'services' ? (
        <StepServices
          selected={state.serviceIds}
          staff={state.staff}
          onToggle={toggleService}
          onClearStylist={() => go({ staff: ANY })}
        />
      ) : null}
      {step === 'stylist' ? (
        <StepStylist
          serviceIds={state.serviceIds}
          staff={staff}
          onChoose={(id) => go({ staff: id, start: null, step: 'time' }, 'push')}
        />
      ) : null}
      {step === 'time' ? (
        <DateTimePicker
          serviceIds={state.serviceIds}
          staffId={staff}
          date={state.date}
          onDateChange={(date) => go({ date, start: null })}
          value={state.start}
          onSelect={(slot) => go({ start: slot.startAt, step: 'review' }, 'push')}
        />
      ) : null}
      {review}
      {step === 'done' && state.bookingId ? <StepSuccess bookingId={state.bookingId} /> : null}

      {step === 'services' && chosen.length > 0 ? (
        <ContinueBar services={chosen} onContinue={() => go({ step: 'stylist' }, 'push')} />
      ) : null}
    </div>
  );
}

// The sticky summary under the services step: count, duration, price and Continue.
function ContinueBar({
  services,
  onContinue,
}: Readonly<{ services: Service[]; onContinue: () => void }>) {
  const sum = totals(services);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <p className="text-sm" aria-live="polite">
          <span className="font-medium">
            {services.length} {services.length === 1 ? 'service' : 'services'}
          </span>{' '}
          · {formatMinutes(sum.durationMin)} · {formatMoney(sum.priceMinor, sum.currency)}
        </p>
        <Button size="lg" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
