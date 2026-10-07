import { Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { loadReviews } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { ReviewList } from '@/features/catalog/components/review-list';
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
  const settings = await loadPublic((api) => api.GET('/api/v1/settings/public'));
  const s = service.data;
  const reviews = await loadReviews({ serviceId: s.id });
  const timeZone = settings.data?.timezone ?? 'UTC';

  return (
    <article className="mx-auto grid max-w-4xl gap-10 px-4 py-12">
      <header className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="grid gap-3">
          <Link href="/services" className="text-sm text-muted-foreground underline">
            All services
          </Link>
          <h1 className="text-3xl font-semibold sm:text-4xl">{s.name}</h1>
          <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
            <span className="text-xl font-medium text-foreground">
              {formatMoney(s.price.amountMinor, s.price.currency)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-4" /> {formatMinutes(s.durationMin)}
            </span>
            <Rating value={s.ratingAvg} count={s.ratingCount} />
          </div>
          {s.description ? <p className="max-w-2xl">{s.description}</p> : null}
          <div>
            <Button asChild size="lg">
              <Link href={`/book?services=${s.id}`}>Book {s.name}</Link>
            </Button>
          </div>
        </div>
        {s.imageUrl ? (
          <Image
            src={s.imageUrl}
            alt=""
            width={280}
            height={280}
            unoptimized
            className="rounded-xl object-cover"
          />
        ) : null}
      </header>

      <section aria-labelledby="who" className="grid gap-4">
        <h2 id="who" className="text-xl font-semibold">
          Who offers it
        </h2>
        {s.stylists.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stylist offers this service right now.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {s.stylists.map((stylist) => (
              <li
                key={stylist.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-3"
              >
                <StylistAvatar name={stylist.displayName} photoUrl={stylist.photoUrl} size={48} />
                <div className="grid gap-0.5">
                  <Link href={`/stylists/${stylist.id}`} className="font-medium hover:underline">
                    {stylist.displayName}
                  </Link>
                  <Rating value={stylist.ratingAvg} count={stylist.ratingCount} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reviews" className="grid gap-4">
        <h2 id="reviews" className="text-xl font-semibold">
          Reviews
        </h2>
        <ReviewList reviews={reviews} timeZone={timeZone} />
      </section>
    </article>
  );
}
