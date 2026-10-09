import { Scissors } from 'lucide-react';
import { IconTile } from '@/components/icon-tile';
import { GrainLayer } from './page-band';

// Shown when the API cannot be reached while rendering a public page.
export function CatalogueUnavailable() {
  return (
    <section className="relative isolate overflow-hidden bg-hero">
      <GrainLayer />
      <div className="mx-auto grid max-w-xl animate-fade-up justify-items-center gap-4 px-4 py-24 text-center">
        <IconTile icon={Scissors} size="lg" />
        <h1 className="text-3xl font-semibold sm:text-4xl">We&apos;ll be right back</h1>
        <div aria-hidden className="rule-brass" />
        <p className="text-muted-foreground">
          Our menu can&apos;t be loaded at the moment. Please try again in a few minutes, or call
          the salon to book.
        </p>
      </div>
    </section>
  );
}
