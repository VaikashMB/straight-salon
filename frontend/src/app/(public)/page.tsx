import { ArrowRight, Clock, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';
import { Button } from '@/components/ui/button';
import { loadCatalogue } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { ServiceCard } from '@/features/catalog/components/service-card';
import { StylistCard } from '@/features/catalog/components/stylist-card';
import { weekHours } from '@/features/catalog/hours';

// Home (05 §3): hero, featured services, stylists, opening hours and a booking CTA. Rendered on
// the server per request from cached API reads (05 §6).
export default async function HomePage() {
  await connection();
  const catalogue = await loadCatalogue();
  if (!catalogue) return <CatalogueUnavailable />;
  const { settings, services, stylists } = catalogue;
  const featured = [...services]
    .sort((a, b) => b.ratingCount - a.ratingCount || a.name.localeCompare(b.name))
    .slice(0, 6);

  return (
    <>
      <section className="border-b bg-secondary/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:py-24">
          <p className="text-sm font-medium tracking-widest text-accent uppercase">
            Hair · Beard · Skin · Nails
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold sm:text-6xl">
            Look sharp. Book in under a minute.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Pick your services, choose a stylist or let us match you, and grab a time that suits you
            at {settings.name}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/book">
                Book now <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/services">See services &amp; prices</Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="featured" className="mx-auto grid max-w-6xl gap-6 px-4 py-14">
        <div className="flex items-end justify-between gap-4">
          <h2 id="featured" className="text-2xl font-semibold sm:text-3xl">
            Popular services
          </h2>
          <Link href="/services" className="text-sm font-medium underline">
            All services
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      </section>

      {stylists.length > 0 ? (
        <section aria-labelledby="stylists" className="mx-auto grid max-w-6xl gap-6 px-4 pb-14">
          <div className="flex items-end justify-between gap-4">
            <h2 id="stylists" className="text-2xl font-semibold sm:text-3xl">
              Meet the team
            </h2>
            <Link href="/stylists" className="text-sm font-medium underline">
              All stylists
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stylists.slice(0, 4).map((stylist) => (
              <StylistCard key={stylist.id} stylist={stylist} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="visit" className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2">
          <div className="grid content-start gap-3">
            <h2 id="visit" className="text-2xl font-semibold">
              Visit us
            </h2>
            {settings.address ? (
              <p className="inline-flex items-start gap-2">
                <MapPin aria-hidden className="mt-0.5 size-4" /> {settings.address}
              </p>
            ) : null}
            {settings.phone ? (
              <p className="inline-flex items-center gap-2">
                <Phone aria-hidden className="size-4" />
                <a href={`tel:${settings.phone}`} className="underline">
                  {settings.phone}
                </a>
              </p>
            ) : null}
          </div>
          <div className="grid content-start gap-3">
            <h2 className="inline-flex items-center gap-2 text-2xl font-semibold">
              <Clock aria-hidden className="size-5" /> Opening hours
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              {weekHours(settings).map(({ day, hours }) => (
                <div key={day} className="contents">
                  <dt className="font-medium">{day}</dt>
                  <dd className="text-muted-foreground">{hours}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
