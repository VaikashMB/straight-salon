'use client';

import { Check, Clock, Star } from 'lucide-react';
import Link from 'next/link';
import { IconTile } from '@/components/icon-tile';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { categoryStyle } from '@/features/catalog/category-style';
import { ServiceImage } from '@/features/catalog/components/service-image';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useCategories, useServices, useStylists, type Category, type Service } from '../api';
import { ANY, MAX_SERVICES } from '../params';
import { CheckBadge, SELECTABLE_CARD } from './selectable';

export function totals(services: Service[]) {
  return {
    durationMin: services.reduce((sum, s) => sum + s.durationMin, 0),
    priceMinor: services.reduce((sum, s) => sum + s.price.amountMinor, 0),
    currency: services[0]?.price.currency ?? 'INR',
  };
}

// One service as a selectable card: its photo (or the category's icon), name, a line of
// description, time, rating and price. Chosen, the photo takes a brass wash with a check.
function ServiceOption({
  service,
  category,
  selected,
  disabled,
  onToggle,
}: {
  service: Service;
  category: Category;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(SELECTABLE_CARD, 'group items-stretch gap-4 p-3 pr-4')}
    >
      <span className="relative w-24 shrink-0 overflow-hidden rounded-xl sm:w-28">
        <ServiceImage
          imageUrl={service.imageUrl}
          category={category}
          sizes="112px"
          className="absolute inset-0"
        />
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 grid place-content-center bg-[#7d5f2c]/55 text-white opacity-0 transition-opacity duration-200',
            selected && 'opacity-100',
          )}
        >
          {selected ? <Check className="size-8 animate-pop drop-shadow" strokeWidth={2.5} /> : null}
        </span>
      </span>
      <span className="grid min-w-0 flex-1 content-between gap-2 py-1">
        <span className="grid gap-1">
          <span className="flex items-start justify-between gap-3">
            <span className="font-heading text-base leading-snug font-semibold">
              {service.name}
            </span>
            <CheckBadge selected={selected} className="mt-0.5" />
          </span>
          {service.description ? (
            <span className="line-clamp-2 text-sm leading-snug text-muted-foreground">
              {service.description}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <Clock aria-hidden className="size-3" />
              {formatMinutes(service.durationMin)}
            </span>
            {service.ratingCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Star aria-hidden className="size-3 fill-accent text-accent" />
                {service.ratingAvg.toFixed(1)}
                <span className="sr-only"> out of 5</span>
              </span>
            ) : null}
          </span>
          <span className="ml-auto font-heading text-lg font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(service.price.amountMinor, service.price.currency)}
          </span>
        </span>
      </span>
    </button>
  );
}

// Step 1: multi-select service cards grouped by category, with a running total (05 §4.1).
// Up to 5 services (BR-008). Coming from a stylist's page, only their services are listed.
// A row of category chips jumps to each group; each group opens with the category's icon.
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
    <div className="grid gap-8">
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
        <output className="block rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">
          You can book up to {MAX_SERVICES} services in one appointment.
        </output>
      ) : null}
      {groups.length > 1 ? (
        <nav aria-label="Service categories" className="-mx-4 overflow-x-auto px-4 pb-1">
          <ul className="flex w-max gap-2">
            {groups.map(({ category, services: list }) => {
              const Icon = categoryStyle(category).icon;
              const picked = list.filter((s) => selected.includes(s.id)).length;
              return (
                <li key={category.id}>
                  <a
                    href={`#cat-${category.id}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3.5 text-sm font-medium shadow-soft transition-colors hover:border-accent/60 hover:bg-accent-soft focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&>svg]:size-4 [&>svg]:text-accent-ink"
                  >
                    <Icon aria-hidden />
                    {category.name}
                    <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                      {picked > 0 ? (
                        <>
                          {picked}/{list.length}
                          <span className="sr-only"> chosen</span>
                        </>
                      ) : (
                        list.length
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      {groups.map(({ category, services: list }) => (
        <section
          key={category.id}
          id={`cat-${category.id}`}
          aria-labelledby={`cat-${category.id}-title`}
          className="grid scroll-mt-28 gap-4"
        >
          <div className="flex items-center gap-3">
            <IconTile
              icon={categoryStyle(category).icon}
              className={cn(categoryStyle(category).tint, categoryStyle(category).ink)}
            />
            <h2 id={`cat-${category.id}-title`} className="font-serif text-2xl tracking-tight">
              {category.name}
            </h2>
            <span
              aria-hidden
              className="h-px flex-1 bg-gradient-to-r from-accent/50 to-transparent"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((service) => {
              const isSelected = selected.includes(service.id);
              return (
                <ServiceOption
                  key={service.id}
                  service={service}
                  category={category}
                  selected={isSelected}
                  disabled={!isSelected && full}
                  onToggle={() => onToggle(service.id)}
                />
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
