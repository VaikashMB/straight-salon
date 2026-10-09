'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePublicSettings } from '@/lib/settings';
import { qualifiedFor, useServices, useStylists, type Stylist } from '../api';
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
import { StepServices } from './step-services';
import { StepStylist } from './step-stylist';
import { StepSuccess } from './step-success';
import { SummaryBar } from './summary-bar';
import { STEPS, WizardProgress } from './wizard-progress';

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

  const position = STEPS.findIndex((l) => l.step === step);
  const content = (
    <>
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
    </>
  );

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 pt-8 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pt-12 sm:pb-16">
      {step !== 'done' ? <WizardProgress current={step} /> : null}
      <div className="flex items-start gap-3">
        {PREVIOUS[step] ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            className="mt-5 size-11 shrink-0 rounded-full sm:size-10"
            onClick={() => go({ step: PREVIOUS[step] }, 'push')}
          >
            <ArrowLeft aria-hidden />
          </Button>
        ) : null}
        <div className="grid gap-2">
          {position >= 0 ? (
            <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
              Step {position + 1} of {STEPS.length}
            </p>
          ) : null}
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold outline-none sm:text-3xl"
          >
            {TITLES[step]}
          </h1>
          <div aria-hidden className="rule-brass" />
        </div>
      </div>

      {/* Keyed by step so each step fades in as it appears. */}
      <div key={step} className="grid animate-fade-up gap-8">
        {content}
      </div>

      {/* Running total on phones; on the services step it also carries Continue. The review
          step renders its own bar, with the Confirm button inside its form. */}
      {step === 'services' && chosen.length > 0 ? (
        <SummaryBar
          services={chosen}
          layout="sticky"
          action={
            <Button size="lg" className="min-w-32" onClick={() => go({ step: 'stylist' }, 'push')}>
              Continue <ArrowRight aria-hidden />
            </Button>
          }
        />
      ) : null}
      {(step === 'stylist' || step === 'time') && chosen.length > 0 ? (
        <SummaryBar services={chosen} layout="mobile" />
      ) : null}
    </div>
  );
}
