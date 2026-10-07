import type { Metadata } from 'next';
import { connection } from 'next/server';
import { loadCatalogue } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { ServiceCatalogue } from '@/features/catalog/components/service-catalogue';

export const metadata: Metadata = {
  title: 'Services & prices',
  description: 'Haircuts, beard care, skin and nail treatments with prices and durations.',
};

// Catalogue with category tabs and search (FR-012, 05 §3).
export default async function ServicesPage() {
  await connection();
  const catalogue = await loadCatalogue();
  if (!catalogue) return <CatalogueUnavailable />;
  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Services &amp; prices</h1>
        <p className="text-muted-foreground">
          Choose one or more services and book them in a single appointment.
        </p>
      </div>
      <ServiceCatalogue categories={catalogue.categories} services={catalogue.services} />
    </section>
  );
}
