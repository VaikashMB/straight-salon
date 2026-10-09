import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { loadReviews } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { stylistSpecialities } from '@/features/catalog/category-style';
import { PageBand } from '@/features/catalog/components/page-band';
import { ReviewList } from '@/features/catalog/components/review-list';
import { SectionHeading } from '@/features/catalog/components/section-heading';
import { SpecialityChips } from '@/features/catalog/components/speciality-chips';
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
  const [settings, categoryList, reviews] = await Promise.all([
    loadPublic((api) => api.GET('/api/v1/settings/public')),
    loadPublic((api) => api.GET('/api/v1/categories')),
    loadReviews({ staffId: s.id }),
  ]);
  const categories = categoryList.data ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const specialities = stylistSpecialities(s, s.services, categories);

  return (
    <article>
      <PageBand innerClassName="max-w-5xl">
        <header className="flex animate-fade-up flex-col gap-8 sm:flex-row sm:items-center">
          <StylistAvatar
            name={s.displayName}
            photoUrl={s.photoUrl}
            size={144}
            className="shadow-lift ring-2 ring-accent ring-offset-4 ring-offset-background"
          />
          <div className="grid gap-4">
            <Link
              href="/stylists"
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="size-4" /> All stylists
            </Link>
            <h1 className="text-4xl leading-tight font-semibold tracking-tighter sm:text-5xl">
              {s.displayName}
            </h1>
            <div aria-hidden className="rule-brass" />
            <Rating value={s.ratingAvg} count={s.ratingCount} />
            <SpecialityChips names={specialities} />
            {s.bio ? <p className="max-w-2xl text-lg">{s.bio}</p> : null}
            <div className="pt-2">
              <Button asChild size="lg" className="shadow-soft">
                <Link href={`/book?staff=${s.id}`}>Book with {s.displayName}</Link>
              </Button>
            </div>
          </div>
        </header>
      </PageBand>

      <div className="mx-auto grid max-w-5xl gap-16 px-4 py-16">
        <section aria-labelledby="offers" className="grid gap-6">
          <SectionHeading id="offers" eyebrow="Menu" title="Services" />
          <div className="grid gap-6 sm:grid-cols-2">
            {s.services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                category={categoryById.get(service.categoryId)}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="reviews" className="grid gap-6">
          <SectionHeading id="reviews" eyebrow="What clients say" title="Reviews" />
          <ReviewList reviews={reviews} timeZone={settings.data?.timezone ?? 'UTC'} />
        </section>
      </div>
    </article>
  );
}
