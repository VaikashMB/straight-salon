import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Step } from '../params';

const LABELS: { step: Step; label: string }[] = [
  { step: 'services', label: 'Services' },
  { step: 'stylist', label: 'Stylist' },
  { step: 'time', label: 'Date & time' },
  { step: 'review', label: 'Confirm' },
];

// The wizard's progress bar (05 §4.1).
export function WizardProgress({ current }: { current: Step }) {
  const index = LABELS.findIndex((l) => l.step === current);
  return (
    <ol aria-label="Booking steps" className="grid grid-cols-4 gap-2 text-xs sm:text-sm">
      {LABELS.map(({ step, label }, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <li key={step} aria-current={active ? 'step' : undefined} className="grid gap-2">
            <span
              className={cn(
                'h-1.5 rounded-full bg-muted',
                (done || active) && 'bg-primary',
                active && 'bg-accent',
              )}
            />
            <span
              className={cn(
                'inline-flex items-center gap-1',
                active ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {done ? <Check aria-hidden className="size-3" /> : null}
              {label}
              {done ? <span className="sr-only">(done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
