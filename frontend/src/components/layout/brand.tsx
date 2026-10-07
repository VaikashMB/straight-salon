import Link from 'next/link';
import { publicEnv } from '@/lib/env';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="font-heading text-lg font-semibold tracking-tight">
      {publicEnv.appName}
      <span aria-hidden className="text-accent">
        .
      </span>
    </Link>
  );
}
