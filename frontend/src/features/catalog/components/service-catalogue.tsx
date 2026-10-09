'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/states/list-states';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Category, Service } from '../api';
import { categoryStyle } from '../category-style';
import { ServiceCard } from './service-card';

const ALL = 'all';

// The catalogue with category tabs and name search (FR-012). The full active list is rendered
// on the server; filtering happens here, so switching tabs is instant.
export function ServiceCatalogue({
  categories,
  services,
}: {
  categories: Category[];
  services: Service[];
}) {
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');
  const tabs = categories.filter((c) => services.some((s) => s.categoryId === c.id));
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return services.filter(
      (s) =>
        (category === ALL || s.categoryId === category) &&
        words.every((w) => s.name.toLowerCase().includes(w)),
    );
  }, [services, category, query]);

  return (
    <div className="grid gap-8">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={category} onValueChange={setCategory} className="min-w-0">
          <TabsList aria-label="Categories" className="h-auto bg-secondary/70">
            <TabsTrigger value={ALL} className="min-h-9">
              All
            </TabsTrigger>
            {tabs.map((c) => {
              const Icon = categoryStyle(c).icon;
              return (
                <TabsTrigger key={c.id} value={c.id} className="min-h-9 gap-1.5">
                  <Icon aria-hidden className="size-4 text-accent" />
                  {c.name}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="relative sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search services"
            placeholder="Search services"
            className="h-10 pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <p aria-live="polite" className="-mt-4 text-sm text-muted-foreground">
        {visible.length} {visible.length === 1 ? 'service' : 'services'}
      </p>
      {visible.length === 0 ? (
        <EmptyState
          title="No services match"
          description="Try another category or a different search."
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              category={categoryById.get(service.categoryId)}
              headingLevel={2}
              className="animate-fade-in"
            />
          ))}
        </div>
      )}
    </div>
  );
}
