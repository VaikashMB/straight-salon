import Link from 'next/link';
import { publicEnv } from '@/lib/env';
import { cn } from '@/lib/utils';

// The salon's monogram: a serif "S" inside a brass ring with a fine inner ring. The same mark is
// the favicon (app/icon.svg). Decorative: the wordmark next to it carries the name.
export function Monogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      data-slot="monogram"
      className={cn('size-8 shrink-0', className)}
    >
      <circle cx="20" cy="20" r="18.5" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle
        cx="20"
        cy="20"
        r="15"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.6"
        opacity="0.6"
      />
      <text
        x="20"
        y="27.5"
        textAnchor="middle"
        fill="currentColor"
        style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontStyle: 'italic' }}
      >
        S
      </text>
    </svg>
  );
}

// The monogram and the serif wordmark with its brass full stop. Colour comes from the surface
// (header or dark footer).
export function Brand({
  href = '/',
  mark = true,
  className,
}: {
  href?: string;
  mark?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2.5 font-serif text-lg font-medium tracking-tight',
        className,
      )}
    >
      {mark ? <Monogram /> : null}
      <span>
        {publicEnv.appName}
        <span aria-hidden className="text-accent">
          .
        </span>
      </span>
    </Link>
  );
}
