'use client';

import { Check, Clock } from 'lucide-react';
import Link from 'next/link';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useCategories, useServices, useStylists, type Service } from '../api';
import { ANY, MAX_SERVICES } from '../params';

export function totals(services: Service[]) {
  return {
    durationMin: services.reduce((sum, s) => sum + s.durationMin, 0),
    priceMinor: services.reduce((sum, s) => sum + s.price.amountMinor, 0),
    currency: services[0]?.price.currency ?? 'INR',
  };
}

// Step 1: multi-select service cards grouped by category, with a running total (05 §4.1).
// Up to 5 services (BR-008). Coming from a stylist's page, only their services are listed.
export function StepServices({
  selected,
  staff,
  onToggle,
  onClearStylist,
}: {
  selected: string[];
  staff: string;
  onToggle: (serviceId: string) => void;
  onClearStylist: () => void;
}) {
  const categories = useCategories();
  const services = useServices();
  const stylists = useStylists();
  const stylist = staff === ANY ? null : stylists.data?.find((s) => s.id === staff);

  if (categories.isPending || services.isPending)
    return <LoadingList rows={4} label="Loading services" />;
  if (categories.error || services.error) {
    return (
      <ErrorState
        error={categories.error ?? services.error}
        onRetry={() => {
          void categories.refetch();
          void services.refetch();
        }}
      />
    );
  }

  const offered = stylist
    ? services.data.filter((s) => stylist.serviceIds.includes(s.id))
    : services.data;
  const full = selected.length >= MAX_SERVICES;
  const groups = categories.data
    .map((category) => ({
      category,
      services: offered.filter((s) => s.categoryId === category.id),
    }))
    .filter((g) => g.services.length > 0);

  return (
    <div className="grid gap-6">
      {stylist ? (
        <Alert>
          <AlertDescription>
            <p>
              Showing the services {stylist.displayName} offers.{' '}
              <button type="button" className="underline" onClick={onClearStylist}>
                Show all services
              </button>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {full ? (
        <p role="status" className="text-sm text-muted-foreground">
          You can book up to {MAX_SERVICES} services in one appointment.
        </p>
      ) : null}
      {groups.map(({ category, services: list }) => (
        <section key={category.id} aria-labelledby={`cat-${category.id}`} className="grid gap-3">
          <h2 id={`cat-${category.id}`} className="text-lg font-semibold">
            {category.name}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((service) => {
              const isSelected = selected.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={!isSelected && full}
                  onClick={() => onToggle(service.id)}
                  className={cn(
                    'flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                    isSelected && 'border-primary ring-1 ring-primary',
                  )}
                >
                  <span className="grid gap-1">
                    <span className="font-medium">{service.name}</span>
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Clock aria-hidden className="size-3.5" />
                      {formatMinutes(service.durationMin)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 font-medium whitespace-nowrap">
                    {formatMoney(service.price.amountMinor, service.price.currency)}
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-5 place-content-center rounded-full border',
                        isSelected && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {isSelected ? <Check className="size-3" /> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No services are available right now.{' '}
          <Link href="/services" className="underline">
            See all services
          </Link>
        </p>
      ) : null}
    </div>
  );
}
