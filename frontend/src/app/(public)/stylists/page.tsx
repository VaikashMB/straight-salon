import type { Metadata } from 'next';
import { connection } from 'next/server';
import { EmptyState } from '@/components/states/list-states';
import { loadCatalogue } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { StylistCard } from '@/features/catalog/components/stylist-card';

export const metadata: Metadata = {
  title: 'Stylists',
  description: 'Meet the stylists and see what our customers say about them.',
};

export default async function StylistsPage() {
  await connection();
  const catalogue = await loadCatalogue();
  if (!catalogue) return <CatalogueUnavailable />;
  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Our stylists</h1>
        <p className="text-muted-foreground">
          Book with someone you know, or let us match you with whoever is free.
        </p>
      </div>
      {catalogue.stylists.length === 0 ? (
        <EmptyState title="Our team is being updated" description="Please check back soon." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalogue.stylists.map((stylist) => (
            <StylistCard key={stylist.id} stylist={stylist} headingLevel={2} />
          ))}
        </div>
      )}
    </section>
  );
}
