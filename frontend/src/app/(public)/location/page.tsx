import { ArrowRight, Clock, Mail, MapPin, Navigation, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { IconTile } from '@/components/icon-tile';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { loadCatalogue } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { PageBand } from '@/features/catalog/components/page-band';
import { weekHours } from '@/features/catalog/hours';
import { directionsUrl, mapEmbedUrl } from '@/features/catalog/location';

export const metadata: Metadata = {
  title: 'Location',
  description: 'Where to find the salon, how to reach us and when we are open.',
};

// The salon's one location (multiple branches are out of scope for v1, 00 §3): address, contact,
// opening hours, directions and a map (tinted to the palette), from the public settings
// (API-016), then a few photos of the studio.
// Stock photos of salon interiors (public/PHOTO-CREDITS.md), illustrating the feel of the studio.
const STUDIO_PHOTOS = [
  { src: '/salon/d.webp', alt: 'Styling chairs facing round mirrors on a dark wall' },
  { src: '/salon/e.webp', alt: 'A bright reception desk with shelves of hair products' },
  { src: '/salon/b.webp', alt: 'Barbers at work in a modern, softly lit studio' },
] as const;

export default async function LocationPage() {
  await connection();
  const catalogue = await loadCatalogue();
  if (!catalogue) return <CatalogueUnavailable />;
  const { settings } = catalogue;
  return (
    <>
      <PageBand>
        <PageHeader
          eyebrow="Find us"
          title="Visit the salon"
          description={`Everything you need to find ${settings.name}, plus when we're open.`}
        />
      </PageBand>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:py-16 lg:grid-cols-[1fr_1.3fr]">
        <div className="grid content-start gap-6">
          <section
            aria-labelledby="contact"
            className="grid animate-fade-up content-start gap-5 rounded-2xl border bg-card p-6 shadow-soft"
          >
            <h2 id="contact" className="text-xl font-semibold">
              {settings.name}
            </h2>
            {settings.address ? (
              <p className="flex items-start gap-4">
                <IconTile icon={MapPin} />
                <span className="pt-2">{settings.address}</span>
              </p>
            ) : null}
            {settings.phone ? (
              <p className="flex items-center gap-4">
                <IconTile icon={Phone} />
                <a
                  href={`tel:${settings.phone}`}
                  className="underline decoration-accent underline-offset-4"
                >
                  {settings.phone}
                </a>
              </p>
            ) : null}
            {settings.email ? (
              <p className="flex items-center gap-4">
                <IconTile icon={Mail} />
                <a
                  href={`mailto:${settings.email}`}
                  className="break-all underline decoration-accent underline-offset-4"
                >
                  {settings.email}
                </a>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild>
                <Link href="/book">
                  Book here <ArrowRight aria-hidden />
                </Link>
              </Button>
              {settings.address ? (
                <Button asChild variant="outline">
                  <a
                    href={directionsUrl(settings.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation aria-hidden /> Get directions
                    <span className="sr-only"> (opens Google Maps in a new tab)</span>
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
          <section
            aria-labelledby="hours"
            className="grid animate-fade-up content-start gap-4 rounded-2xl border bg-card p-6 shadow-soft [animation-delay:80ms]"
          >
            <h2 id="hours" className="inline-flex items-center gap-3 text-xl font-semibold">
              <IconTile icon={Clock} size="sm" /> Opening hours
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
              {weekHours(settings).map(({ day, hours }) => (
                <div key={day} className="contents">
                  <dt className="font-medium">{day}</dt>
                  <dd className="text-muted-foreground tabular-nums">{hours}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        {settings.address ? (
          <div className="min-h-80 animate-fade-up overflow-hidden rounded-[1.75rem] border bg-muted shadow-lift ring-1 ring-accent/30 [animation-delay:160ms] lg:min-h-full">
            <iframe
              title={`Map showing ${settings.name}`}
              src={mapEmbedUrl(settings.address)}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="size-full min-h-80 border-0 map-tint"
            />
          </div>
        ) : null}
      </div>
      <section aria-labelledby="inside" className="mx-auto grid max-w-6xl gap-6 px-4 pb-16">
        <h2 id="inside" className="sr-only">
          Inside the studio
        </h2>
        <div className="grid reveal gap-4 sm:grid-cols-3">
          {STUDIO_PHOTOS.map((photo, i) => (
            <div
              key={photo.src}
              className={`relative overflow-hidden rounded-2xl shadow-soft ring-1 ring-border ${i === 0 ? 'aspect-[4/3] sm:col-span-2 sm:aspect-auto' : 'aspect-[4/3]'}`}
            >
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes={
                  i === 0 ? '(min-width: 640px) 48rem, 100vw' : '(min-width: 640px) 24rem, 100vw'
                }
                className="object-cover transition duration-700 hover:scale-105"
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
