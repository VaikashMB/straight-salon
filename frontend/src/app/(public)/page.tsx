import { ArrowRight, CalendarCheck, Clock, Gift, MapPin, Phone, UserRound } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { ShearsIcon } from '@/components/brand-icons';
import { CountUp } from '@/components/count-up';
import { IconTile } from '@/components/icon-tile';
import { Button } from '@/components/ui/button';
import { loadCatalogue, loadFeaturedReviews, salonStats } from '@/features/catalog/api';
import { stylistSpecialities } from '@/features/catalog/category-style';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { BrandMarquee } from '@/features/catalog/components/brand-marquee';
import { LooksCarousel } from '@/features/catalog/components/looks-carousel';
import { GrainLayer } from '@/features/catalog/components/page-band';
import { SectionHeading, sectionLinkClass } from '@/features/catalog/components/section-heading';
import { ServiceCard } from '@/features/catalog/components/service-card';
import { StylistCard } from '@/features/catalog/components/stylist-card';
import { Testimonials } from '@/features/catalog/components/testimonials';
import { weekHours } from '@/features/catalog/hours';

const STEPS = [
  {
    icon: ShearsIcon,
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

const STUDIO_POINTS = [
  'Consultation first, every visit',
  'Products we trust, explained',
  'On time, or we tell you why',
] as const;

// Staggered entrance for items in a row (switched off under prefers-reduced-motion).
const delay = (i: number) => ({ animationDelay: `${80 + i * 80}ms` });

// Home (05 §3): a full-bleed photo hero with live salon figures, how it works, signature looks,
// the studio, popular services, the team, testimonials from real reviews, gift cards and
// opening hours. Rendered on the server per request from cached API reads (05 §6). Sections
// below the fold reveal as they scroll in (CSS only).
export default async function HomePage() {
  await connection();
  const [catalogue, reviews] = await Promise.all([loadCatalogue(), loadFeaturedReviews()]);
  if (!catalogue) return <CatalogueUnavailable />;
  const { settings, categories, services, stylists } = catalogue;
  const stats = salonStats(catalogue);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const featured = [...services]
    .sort((a, b) => b.ratingCount - a.ratingCount || a.name.localeCompare(b.name))
    .slice(0, 6);

  return (
    <>
      <section className="relative isolate flex min-h-[min(92svh,56rem)] items-end overflow-hidden bg-[#0f0d0b] text-[#faf7f2]">
        <Image
          src="/salon/a.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-20 animate-ken-burns object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0f0d0b] via-[#0f0d0b]/70 to-[#0f0d0b]/25"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0f0d0b]/80 via-[#0f0d0b]/30 to-transparent"
        />
        <GrainLayer />
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-28 pb-10 sm:pt-36">
          <div className="grid max-w-3xl animate-fade-up gap-6">
            <p className="text-xs font-semibold tracking-[0.28em] text-[#d4b483] uppercase sm:text-sm">
              Hair · Beard · Skin · Nails
            </p>
            <h1 className="text-[2.9rem] leading-[1.02] font-normal tracking-tight sm:text-7xl xl:text-[5.5rem]">
              Look <em className="font-light text-[#d4b483]">sharp</em>.{' '}
              <span className="block">Book in under a minute.</span>
            </h1>
            <div aria-hidden className="rule-brass w-20" />
            <p className="max-w-xl text-lg text-[#faf7f2]/80">
              Pick your services, choose a stylist or let us match you, and grab a time that suits
              you at {settings.name}.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild size="lg" variant="accent" className="shine shadow-lift">
                <Link href="/book">
                  Book now <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/30 bg-white/5 text-[#faf7f2] backdrop-blur hover:bg-white/15 hover:text-white"
              >
                <Link href="/services">See services &amp; prices</Link>
              </Button>
            </div>
          </div>
          <dl
            aria-label="The salon in numbers"
            className="grid animate-fade-up grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur-md [animation-delay:250ms] sm:grid-cols-4"
          >
            {stats.rating !== null ? (
              <div className="grid gap-1 bg-[#0f0d0b]/45 px-5 py-4">
                <dt className="text-xs tracking-[0.14em] text-[#faf7f2]/70 uppercase">
                  Average rating
                </dt>
                <dd className="font-serif text-3xl sm:text-4xl">
                  {stats.rating.toFixed(1)}
                  <span className="text-[#d4b483]">★</span>
                </dd>
              </div>
            ) : null}
            {stats.reviews > 0 ? (
              <div className="grid gap-1 bg-[#0f0d0b]/45 px-5 py-4">
                <dt className="text-xs tracking-[0.14em] text-[#faf7f2]/70 uppercase">
                  Client reviews
                </dt>
                <dd className="font-serif text-3xl sm:text-4xl">
                  <CountUp value={stats.reviews} />
                </dd>
              </div>
            ) : null}
            <div className="grid gap-1 bg-[#0f0d0b]/45 px-5 py-4">
              <dt className="text-xs tracking-[0.14em] text-[#faf7f2]/70 uppercase">Services</dt>
              <dd className="font-serif text-3xl sm:text-4xl">
                <CountUp value={stats.services} />
              </dd>
            </div>
            <div className="grid gap-1 bg-[#0f0d0b]/45 px-5 py-4">
              <dt className="text-xs tracking-[0.14em] text-[#faf7f2]/70 uppercase">Stylists</dt>
              <dd className="font-serif text-3xl sm:text-4xl">
                <CountUp value={stats.stylists} />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="how" className="border-b bg-card">
        <div className="mx-auto grid max-w-6xl reveal gap-10 px-4 py-16 sm:py-24">
          <SectionHeading id="how" eyebrow="How it works" title="Booked in three steps" />
          <ol className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                style={delay(i)}
                className="relative grid animate-fade-up content-start gap-3 rounded-2xl border bg-background p-6 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
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

      <section aria-labelledby="looks" className="relative isolate overflow-hidden bg-hero">
        <GrainLayer />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 md:grid-cols-[0.9fr_1.1fr]">
          <div className="grid reveal content-center gap-6">
            <SectionHeading
              id="looks"
              eyebrow="Signature looks"
              title={
                <>
                  Made in our chairs, <em className="text-accent-ink">styled</em> for you
                </>
              }
              description="Each look is tied to a service on the menu, with its live price. Like one? Book it in a tap."
            />
            <Link href="/gallery" className={`${sectionLinkClass} justify-self-start`}>
              Browse the full lookbook <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <LooksCarousel
            services={services}
            className="w-full max-w-md reveal justify-self-center md:justify-self-end"
          />
        </div>
      </section>

      <section aria-labelledby="brands" className="border-y py-14 sm:py-16">
        <div className="mx-auto grid max-w-6xl gap-8 px-4">
          <SectionHeading id="brands" eyebrow="In the chair" title="Products we trust" />
        </div>
        <BrandMarquee className="mt-8" />
      </section>

      <section
        aria-labelledby="featured"
        className="mx-auto grid max-w-6xl reveal gap-10 px-4 py-16 sm:py-24"
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

      <section aria-labelledby="studio" className="overflow-hidden border-y bg-card">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:py-24 lg:grid-cols-2">
          {/* Editorial collage: three overlapping photos, the back two drifting on scroll. */}
          <div aria-hidden className="relative mx-auto aspect-[5/6] w-full max-w-md reveal">
            <div className="absolute top-0 left-0 h-[72%] w-[62%] -rotate-3 overflow-hidden rounded-[1.5rem] shadow-lift ring-1 ring-accent/30">
              <Image
                src="/salon/c.webp"
                alt=""
                fill
                sizes="18rem"
                className="parallax object-cover"
              />
            </div>
            <div className="absolute top-[10%] right-0 h-[48%] w-[50%] rotate-2 overflow-hidden rounded-[1.5rem] shadow-lift ring-1 ring-accent/30">
              <Image
                src="/gallery/balayage.webp"
                alt=""
                fill
                sizes="14rem"
                className="parallax object-cover"
              />
            </div>
            <div className="absolute right-[8%] bottom-0 h-[50%] w-[58%] -rotate-1 overflow-hidden rounded-[1.5rem] border-4 border-card shadow-lift">
              <Image src="/salon/f.webp" alt="" fill sizes="16rem" className="object-cover" />
            </div>
          </div>
          <div className="grid reveal content-center gap-6">
            <SectionHeading
              id="studio"
              eyebrow="The studio"
              title={
                <>
                  A studio built around <em className="text-accent-ink">the chair</em>
                </>
              }
              description="Warm light, good music and people who take their time. Every visit starts with a conversation about what you want, and ends with you knowing how to keep it."
            />
            <ul className="grid gap-3">
              {STUDIO_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-3">
                  <span aria-hidden className="h-px w-8 bg-accent" />
                  <span className="font-serif text-xl">{point}</span>
                </li>
              ))}
            </ul>
            <Link href="/stylists" className={`${sectionLinkClass} justify-self-start`}>
              Meet the people behind the chairs <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {stylists.length > 0 ? (
        <section aria-labelledby="stylists" className="border-b">
          <div className="mx-auto grid max-w-6xl reveal gap-10 px-4 py-16 sm:py-24">
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

      {reviews.length > 0 ? (
        <section
          aria-labelledby="testimonials"
          className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24"
        >
          <SectionHeading
            id="testimonials"
            eyebrow="Kind words"
            title={
              <>
                What our clients <em className="text-accent-ink">say</em>
              </>
            }
          />
          <Testimonials reviews={reviews} />
        </section>
      ) : null}

      <section aria-labelledby="gift" className="px-4">
        <div className="relative isolate mx-auto grid max-w-6xl reveal items-center gap-6 overflow-hidden rounded-[1.75rem] bg-sidebar px-6 py-10 text-sidebar-foreground shadow-lift sm:grid-cols-[auto_1fr_auto] sm:px-10">
          <Image
            src="/salon/e.webp"
            alt=""
            fill
            sizes="(min-width: 1152px) 72rem, 100vw"
            className="-z-10 object-cover opacity-20"
          />
          <IconTile
            icon={Gift}
            size="lg"
            className="bg-sidebar-accent/15 text-sidebar-accent ring-sidebar-accent/40"
          />
          <div className="grid gap-1">
            <h2 id="gift" className="text-2xl sm:text-3xl">
              Gift a fresh look
            </h2>
            <p className="text-sidebar-muted">
              Gift cards for any amount are available at the front desk. The easiest present to get
              right.
            </p>
          </div>
          <Button asChild variant="accent" className="shine justify-self-start">
            <Link href="/location">
              Visit us <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="visit"
        className="mx-auto grid max-w-6xl reveal gap-10 px-4 py-16 sm:py-24"
      >
        <SectionHeading id="visit" eyebrow="Find us" title="Visit us" />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid content-start gap-5 rounded-2xl border bg-card p-6 shadow-soft">
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
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild className="shine">
                <Link href="/book">
                  Book a visit <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/location">
                  <MapPin aria-hidden /> Map &amp; directions
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid content-start gap-4 rounded-2xl border bg-card p-6 shadow-soft">
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
