import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared look of the wizard's selectable cards (services, stylists). The selected look follows
// the button's own semantics (aria-pressed / aria-checked), so style and state can't drift:
// brass ring and border, a soft brass tint and a check badge. Enabled cards lift on hover.
export const SELECTABLE_CARD = cn(
  'group/card relative flex gap-4 rounded-2xl border bg-card p-4 text-left shadow-soft outline-none',
  'transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out',
  'enabled:hover:-translate-y-0.5 enabled:hover:border-accent/60 enabled:hover:shadow-lift',
  'focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
  'aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:ring-2 aria-checked:ring-accent',
  'aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:ring-2 aria-pressed:ring-accent',
);

// The round check in the card's corner: an empty circle, filled brass with a check once chosen.
// Decorative: screen readers get the state from aria-pressed / aria-checked on the card.
export function CheckBadge({
  selected,
  className,
}: Readonly<{ selected: boolean; className?: string }>) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-content-center rounded-full border-2 border-input bg-background transition-colors duration-200',
        selected && 'border-accent bg-accent text-accent-foreground',
        className,
      )}
    >
      {selected ? <Check className="size-3.5 animate-pop" strokeWidth={3} /> : null}
    </span>
  );
}
