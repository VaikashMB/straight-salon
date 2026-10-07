import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { loadReviews } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { ReviewList } from '@/features/catalog/components/review-list';
import { ServiceCard } from '@/features/catalog/components/service-card';
import { StylistAvatar } from '@/features/catalog/components/stylist-avatar';
import { loadPublic } from '@/lib/api/server';

type Props = { params: Promise<{ id: string }> };

const loadStylist = (id: string) =>
  loadPublic((api) => api.GET('/api/v1/staff/{id}', { params: { path: { id } } }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data } = await loadStylist(id);
  return data ? { title: data.displayName, description: data.bio } : { title: 'Stylist' };
}

// Stylist profile (API-031) with the services they offer and their reviews (API-061).
export default async function StylistPage({ params }: Props) {
  await connection();
  const { id } = await params;
  const stylist = await loadStylist(id);
  if (!stylist.data) {
    if (stylist.notFound) notFound();
    return <CatalogueUnavailable />;
  }
  const s = stylist.data;
  const [settings, reviews] = await Promise.all([
    loadPublic((api) => api.GET('/api/v1/settings/public')),
    loadReviews({ staffId: s.id }),
  ]);

  return (
    <article className="mx-auto grid max-w-5xl gap-10 px-4 py-12">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <StylistAvatar name={s.displayName} photoUrl={s.photoUrl} size={112} />
        <div className="grid gap-3">
          <Link href="/stylists" className="text-sm text-muted-foreground underline">
            All stylists
          </Link>
          <h1 className="text-3xl font-semibold sm:text-4xl">{s.displayName}</h1>
          <Rating value={s.ratingAvg} count={s.ratingCount} />
          {s.bio ? <p className="max-w-2xl">{s.bio}</p> : null}
          <div>
            <Button asChild size="lg">
              <Link href={`/book?staff=${s.id}`}>Book with {s.displayName}</Link>
            </Button>
          </div>
        </div>
      </header>

      <section aria-labelledby="offers" className="grid gap-4">
        <h2 id="offers" className="text-xl font-semibold">
          Services
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {s.services.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      </section>

      <section aria-labelledby="reviews" className="grid gap-4">
        <h2 id="reviews" className="text-xl font-semibold">
          Reviews
        </h2>
        <ReviewList reviews={reviews} timeZone={settings.data?.timezone ?? 'UTC'} />
      </section>
    </article>
  );
}
