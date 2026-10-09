import type { ReactNode } from 'react';

// Page title block shared by every area: optional brass eyebrow, the h1, a description and
// actions on the right (wrapping under the title on narrow screens).
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-up flex-wrap items-end justify-between gap-4">
      <div className="grid gap-2">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        <div aria-hidden className="rule-brass" />
        {description ? <p className="max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
