import type { Metadata } from 'next';
import { connection } from 'next/server';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states/list-states';
import { loadCatalogue } from '@/features/catalog/api';
import { stylistSpecialities } from '@/features/catalog/category-style';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { PageBand } from '@/features/catalog/components/page-band';
import { StylistCard } from '@/features/catalog/components/stylist-card';

export const metadata: Metadata = {
  title: 'Stylists',
  description: 'Meet the stylists and see what our customers say about them.',
};

export default async function StylistsPage() {
  await connection();
  const catalogue = await loadCatalogue();
  if (!catalogue) return <CatalogueUnavailable />;
  const { stylists, services, categories } = catalogue;
  return (
    <>
      <PageBand>
        <PageHeader
          eyebrow="The team"
          title="Our stylists"
          description="Book with someone you know, or let us match you with whoever is free."
        />
      </PageBand>
      <section aria-label="Stylist list" className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
        {stylists.length === 0 ? (
          <EmptyState title="Our team is being updated" description="Please check back soon." />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {stylists.map((stylist, i) => (
              <StylistCard
                key={stylist.id}
                stylist={stylist}
                specialities={stylistSpecialities(stylist, services, categories)}
                headingLevel={2}
                className="animate-fade-up"
                style={{ animationDelay: `${80 + i * 70}ms` }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
