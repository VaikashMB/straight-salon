import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Heading block for a public page section: brass eyebrow, the h2 (its id labels the section),
// the brass rule, and an optional link on the right.
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="grid gap-2">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h2 id={id} className="text-3xl font-semibold sm:text-4xl">
          {title}
        </h2>
        <div aria-hidden className="mt-1 rule-brass" />
        {description ? <p className="max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// "All services →" style link next to a section heading.
export const sectionLinkClass =
  'inline-flex min-h-11 items-center gap-1 text-sm font-medium underline decoration-accent underline-offset-4 hover:text-accent-ink';
