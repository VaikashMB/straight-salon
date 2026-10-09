import { ArrowLeft, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { loadReviews } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { PageBand } from '@/features/catalog/components/page-band';
import { PricePill } from '@/features/catalog/components/price-pill';
import { ReviewList } from '@/features/catalog/components/review-list';
import { SectionHeading } from '@/features/catalog/components/section-heading';
import { ServiceImage } from '@/features/catalog/components/service-image';
import { StylistAvatar } from '@/features/catalog/components/stylist-avatar';
import { loadPublic } from '@/lib/api/server';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';

type Props = { params: Promise<{ slug: string }> };

const loadService = (slug: string) =>
  loadPublic((api) =>
    api.GET('/api/v1/services/{idOrSlug}', { params: { path: { idOrSlug: slug } } }),
  );

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await loadService(slug);
  return data ? { title: data.name, description: data.description } : { title: 'Service' };
}

// Service detail (API-024): description, price, duration, who performs it, reviews (API-061).
export default async function ServicePage({ params }: Props) {
  await connection();
  const { slug } = await params;
  const service = await loadService(slug);
  if (!service.data) {
    if (service.notFound) notFound();
    return <CatalogueUnavailable />;
  }
  const s = service.data;
  const [settings, categories, reviews] = await Promise.all([
    loadPublic((api) => api.GET('/api/v1/settings/public')),
    loadPublic((api) => api.GET('/api/v1/categories')),
    loadReviews({ serviceId: s.id }),
  ]);
  const timeZone = settings.data?.timezone ?? 'UTC';
  const category = categories.data?.find((c) => c.id === s.categoryId);

  return (
    <article>
      <PageBand innerClassName="max-w-5xl">
        <header className="grid animate-fade-up gap-8 md:grid-cols-[1fr_20rem] md:items-center">
          <div className="grid gap-4">
            <Link
              href="/services"
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="size-4" /> All services
            </Link>
            {category ? (
              <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
                {category.name}
              </p>
            ) : null}
            <h1 className="text-4xl leading-tight font-semibold tracking-tighter sm:text-5xl">
              {s.name}
            </h1>
            <div aria-hidden className="rule-brass" />
            <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
              <PricePill size="lg">{formatMoney(s.price.amountMinor, s.price.currency)}</PricePill>
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden className="size-4" /> {formatMinutes(s.durationMin)}
              </span>
              <Rating value={s.ratingAvg} count={s.ratingCount} />
            </div>
            {s.description ? <p className="max-w-2xl text-lg">{s.description}</p> : null}
            <div className="pt-2">
              <Button asChild size="lg" className="shadow-soft">
                <Link href={`/book?services=${s.id}`}>Book {s.name}</Link>
              </Button>
            </div>
          </div>
          <ServiceImage
            imageUrl={s.imageUrl}
            category={category}
            sizes="(min-width: 768px) 20rem, 100vw"
            className="aspect-[4/3] rounded-2xl border shadow-lift"
          />
        </header>
      </PageBand>

      <div className="mx-auto grid max-w-5xl gap-16 px-4 py-16">
        <section aria-labelledby="who" className="grid gap-6">
          <SectionHeading id="who" eyebrow="Stylists" title="Who offers it" />
          {s.stylists.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No stylist offers this service right now.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {s.stylists.map((stylist) => (
                <li
                  key={stylist.id}
                  className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lift"
                >
                  <StylistAvatar
                    name={stylist.displayName}
                    photoUrl={stylist.photoUrl}
                    size={56}
                    className="ring-2 ring-accent ring-offset-2 ring-offset-card"
                  />
                  <div className="grid gap-0.5">
                    <Link
                      href={`/stylists/${stylist.id}`}
                      className="font-heading text-lg font-semibold decoration-accent underline-offset-4 hover:underline"
                    >
                      {stylist.displayName}
                    </Link>
                    <Rating value={stylist.ratingAvg} count={stylist.ratingCount} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="reviews" className="grid gap-6">
          <SectionHeading id="reviews" eyebrow="What clients say" title="Reviews" />
          <ReviewList reviews={reviews} timeZone={timeZone} />
        </section>
      </div>
    </article>
  );
}
