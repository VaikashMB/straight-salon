import type { Metadata } from 'next';
import Link from 'next/link';
import { PageBand } from '@/features/catalog/components/page-band';
import { GalleryGrid } from '@/features/gallery/components/gallery-grid';
import { isLookCategory, LOOK_CATEGORIES, looksIn } from '@/features/gallery/looks';

export const metadata: Metadata = {
  title: 'Gallery',
  description: 'Cuts, colour, beards and nails: a lookbook of the work on our menu.',
};

type Props = { searchParams: Promise<{ category?: string }> };

const chipClass =
  'inline-flex min-h-10 items-center rounded-full border px-4 text-sm transition-colors hover:border-accent/60 aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground';

// The lookbook (05 §3): a masonry grid of finished looks with a category filter. The filter is
// plain links (?category=), so it works without JavaScript and each view has its own URL.
export default async function GalleryPage({ searchParams }: Props) {
  const { category } = await searchParams;
  const active = isLookCategory(category) ? category : undefined;
  const looks = looksIn(active);
  return (
    <>
      <PageBand>
        <div className="grid animate-fade-up gap-4">
          <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
            Lookbook
          </p>
          <h1 className="text-4xl leading-tight font-semibold sm:text-6xl">
            Looks we <em className="text-accent-ink">love</em>
          </h1>
          <div aria-hidden className="rule-brass" />
          <p className="max-w-2xl text-lg text-muted-foreground">
            Cuts, colour, beards and nails. Find a look you like, then book the service behind it.
          </p>
        </div>
      </PageBand>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:py-16">
        <nav aria-label="Filter looks" className="flex flex-wrap gap-2">
          <Link
            href="/gallery"
            aria-current={active ? undefined : 'page'}
            className={chipClass}
            scroll={false}
          >
            All
          </Link>
          {LOOK_CATEGORIES.map((c) => (
            <Link
              key={c.value}
              href={`/gallery?category=${c.value}`}
              aria-current={active === c.value ? 'page' : undefined}
              className={chipClass}
              scroll={false}
            >
              {c.label}
            </Link>
          ))}
        </nav>
        <GalleryGrid looks={looks} />
        <p className="text-xs text-muted-foreground">
          Photos are royalty-free stock from Unsplash and show the kind of work on our menu.
        </p>
      </div>
    </>
  );
}
