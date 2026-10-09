import type { Metadata } from 'next';
import { connection } from 'next/server';
import { PageHeader } from '@/components/page-header';
import { loadCatalogue } from '@/features/catalog/api';
import { CatalogueUnavailable } from '@/features/catalog/components/catalogue-unavailable';
import { PageBand } from '@/features/catalog/components/page-band';
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
    <>
      <PageBand>
        <PageHeader
          eyebrow="Our menu"
          title="Services & prices"
          description="Choose one or more services and book them in a single appointment."
        />
      </PageBand>
      <section
        aria-label="Service list"
        className="mx-auto max-w-6xl animate-fade-up px-4 py-12 [animation-delay:100ms] sm:py-16"
      >
        <ServiceCatalogue categories={catalogue.categories} services={catalogue.services} />
      </section>
    </>
  );
}
