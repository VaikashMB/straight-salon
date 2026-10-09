import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Step } from '../params';

export const STEPS: { step: Step; label: string }[] = [
  { step: 'services', label: 'Services' },
  { step: 'stylist', label: 'Stylist' },
  { step: 'time', label: 'Date & time' },
  { step: 'review', label: 'Confirm' },
];

// The wizard's stepper (05 §4.1): numbered circles joined by a line that fills with brass as
// the customer moves on. An ordered list, so screen readers hear "1 of 4" etc.; the current step
// carries aria-current and finished steps say "(done)".
export function WizardProgress({ current }: { current: Step }) {
  const index = STEPS.findIndex((l) => l.step === current);
  return (
    <ol aria-label="Booking steps" className="grid grid-cols-4 text-xs sm:text-sm">
      {STEPS.map(({ step, label }, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className="relative grid justify-items-center gap-2 text-center"
          >
            {i < STEPS.length - 1 ? (
              // Connector to the next circle; its brass fill grows once this step is done.
              <span
                aria-hidden
                className="absolute top-4 right-[calc(-50%+1.25rem)] left-[calc(50%+1.25rem)] h-0.5 overflow-hidden rounded-full bg-border"
              >
                <span
                  className={cn(
                    'block h-full origin-left bg-accent transition-transform duration-500 ease-out',
                    done ? 'scale-x-100' : 'scale-x-0',
                  )}
                />
              </span>
            ) : null}
            <span
              aria-hidden
              className={cn(
                'relative grid size-8 place-content-center rounded-full border text-sm font-semibold tabular-nums transition-all duration-300',
                done && 'border-accent bg-accent text-accent-foreground',
                active && 'border-primary bg-primary text-primary-foreground ring-4 ring-accent/35',
                !done && !active && 'bg-card text-muted-foreground',
              )}
            >
              {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                'leading-tight',
                active && 'font-semibold text-foreground',
                done && 'text-accent-ink',
                !done && !active && 'text-muted-foreground',
              )}
            >
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
