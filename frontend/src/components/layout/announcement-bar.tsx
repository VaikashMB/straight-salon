import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { SparkleIcon } from '@/components/brand-icons';

// A slim brass-on-dark strip above the public header with one short, true message about
// visiting the salon. Static copy: change it here.
export function AnnouncementBar() {
  return (
    <aside
      aria-label="Announcement"
      className="bg-sidebar text-sidebar-foreground"
      data-slot="announcement"
    >
      <p className="mx-auto flex min-h-9 max-w-6xl flex-wrap items-center justify-center gap-x-2 px-4 py-1.5 text-center text-xs tracking-wide sm:text-[0.8rem]">
        <SparkleIcon className="size-3.5 text-sidebar-accent" />
        <span>Book online in under a minute, pay at the salon.</span>
        <Link
          href="/gallery"
          className="inline-flex items-center gap-1 font-medium text-sidebar-accent underline-offset-4 hover:underline"
        >
          See our latest looks <ArrowRight aria-hidden className="size-3" />
        </Link>
      </p>
    </aside>
  );
}
