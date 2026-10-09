import Link from 'next/link';
import { publicEnv } from '@/lib/env';
import { cn } from '@/lib/utils';

// The wordmark with its brass full stop. Colour comes from the surface (header or dark footer).
export function Brand({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn('font-heading text-lg font-semibold tracking-tight', className)}
    >
      {publicEnv.appName}
      <span aria-hidden className="text-accent">
        .
      </span>
    </Link>
  );
}
