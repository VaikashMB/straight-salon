import { ArrowRight, CalendarCheck, Clock, MapPin, Phone, Scissors, UserRound } from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';
import { IconTile } from '@/components/icon-tile';
import { Button } from '@/components/ui/button';
import { loadCatalogue } from '@/features/catalog/api';
import { stylistSpecialities } from '@/features/catalog/category-style';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { HeroArt } from '@/features/catalog/components/hero-art';
import { GrainLayer } from '@/features/catalog/components/page-band';
import { SectionHeading, sectionLinkClass } from '@/features/catalog/components/section-heading';
import { ServiceCard } from '@/features/catalog/components/service-card';
import { StylistCard } from '@/features/catalog/components/stylist-card';
import { weekHours } from '@/features/catalog/hours';

const STEPS = [
  {
    icon: Scissors,
    title: 'Pick your services',
    text: 'Combine a cut, a beard trim or a facial in one visit. Prices and times are up front.',
  },
  {
    icon: UserRound,
    title: 'Choose a stylist',
    text: 'Book someone you know, or let us match you with whoever is free.',
  },
  {
    icon: CalendarCheck,
    title: 'Pick a time',
    text: 'See the free slots for the next few weeks and confirm in a tap.',
  },
] as const;

// Staggered entrance for items in a row (switched off under prefers-reduced-motion).
const delay = (i: number) => ({ animationDelay: `${80 + i * 80}ms` });

// Home (05 §3): hero, how it works, featured services, stylists, opening hours and a booking
// CTA. Rendered on the server per request from cached API reads (05 §6).
export default async function HomePage() {
  await connection();
  const catalogue = await loadCatalogue();
  if (!catalogue) return <CatalogueUnavailable />;
  const { settings, categories, services, stylists } = catalogue;
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const featured = [...services]
    .sort((a, b) => b.ratingCount - a.ratingCount || a.name.localeCompare(b.name))
    .slice(0, 6);

  return (
    <>
      <section className="relative isolate overflow-hidden border-b bg-hero">
        <GrainLayer />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-24 md:grid-cols-[1.25fr_0.75fr] lg:py-28">
          <div className="grid animate-fade-up gap-6">
            <p className="text-xs font-semibold tracking-[0.22em] text-accent-ink uppercase sm:text-sm">
              Hair · Beard · Skin · Nails
            </p>
            <h1 className="max-w-3xl text-[2.6rem] leading-[1.04] font-semibold tracking-tighter sm:text-6xl lg:text-7xl">
              Look sharp. <span className="text-accent-ink">Book in under a minute.</span>
            </h1>
            <div aria-hidden className="rule-brass w-16" />
            <p className="max-w-xl text-lg text-muted-foreground">
              Pick your services, choose a stylist or let us match you, and grab a time that suits
              you at {settings.name}.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild size="lg" className="shadow-soft">
                <Link href="/book">
                  Book now <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/services">See services &amp; prices</Link>
              </Button>
            </div>
          </div>
          <HeroArt className="hidden w-full max-w-sm animate-fade-in justify-self-end [animation-delay:200ms] md:block" />
        </div>
      </section>

      <section aria-labelledby="how" className="border-b bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24">
          <SectionHeading id="how" eyebrow="How it works" title="Booked in three steps" />
          <ol className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                style={delay(i)}
                className="relative grid animate-fade-up content-start gap-3 rounded-2xl border bg-background p-6"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid size-8 place-content-center rounded-full bg-accent font-heading text-sm font-semibold text-accent-foreground"
                  >
                    {i + 1}
                  </span>
                  <IconTile icon={step.icon} size="sm" />
                </div>
                <h3 className="text-lg font-semibold">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        aria-labelledby="featured"
        className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24"
      >
        <SectionHeading
          id="featured"
          eyebrow="Most booked"
          title="Popular services"
          action={
            <Link href="/services" className={sectionLinkClass}>
              All services <ArrowRight aria-hidden className="size-4" />
            </Link>
          }
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((service, i) => (
            <ServiceCard
              key={service.id}
              service={service}
              category={categoryById.get(service.categoryId)}
              className="animate-fade-up"
              style={delay(i)}
            />
          ))}
        </div>
      </section>

      {stylists.length > 0 ? (
        <section aria-labelledby="stylists" className="border-y bg-card">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24">
            <SectionHeading
              id="stylists"
              eyebrow="The chairs"
              title="Meet the team"
              action={
                <Link href="/stylists" className={sectionLinkClass}>
                  All stylists <ArrowRight aria-hidden className="size-4" />
                </Link>
              }
            />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {stylists.slice(0, 4).map((stylist, i) => (
                <StylistCard
                  key={stylist.id}
                  stylist={stylist}
                  specialities={stylistSpecialities(stylist, services, categories)}
                  className="animate-fade-up"
                  style={delay(i)}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="visit"
        className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24"
      >
        <SectionHeading id="visit" eyebrow="Find us" title="Visit us" />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid animate-fade-up content-start gap-5 rounded-2xl border bg-card p-6 shadow-soft">
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
            <div className="pt-2">
              <Button asChild>
                <Link href="/book">
                  Book a visit <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
          <div
            style={delay(1)}
            className="grid animate-fade-up content-start gap-4 rounded-2xl border bg-card p-6 shadow-soft"
          >
            <h3 className="inline-flex items-center gap-3 text-xl font-semibold">
              <IconTile icon={Clock} size="sm" /> Opening hours
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
              {weekHours(settings).map(({ day, hours }) => (
                <div key={day} className="contents">
                  <dt className="font-medium">{day}</dt>
                  <dd className="text-muted-foreground tabular-nums">{hours}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
