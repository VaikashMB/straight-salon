import { loadPublic } from '@/lib/api/server';
import type { Schemas } from '@/lib/api/client';

// Public catalogue reads for Server Components (05 §6), cached by Next for 5 minutes.

export type Category = Schemas['Category'];
export type Service = Schemas['Service'];
export type ServiceDetail = Schemas['ServiceDetail'];
export type Stylist = Schemas['Staff'];
export type StylistProfile = Schemas['StaffProfile'];
export type Review = Schemas['Review'];
export type PublicSettings = Schemas['PublicSettings'];

export interface Catalogue {
  settings: PublicSettings;
  categories: Category[];
  services: Service[];
  stylists: Stylist[];
}

// Everything the home and catalogue pages show, or null if the API is unreachable.
export async function loadCatalogue(): Promise<Catalogue | null> {
  const [settings, categories, services, stylists] = await Promise.all([
    loadPublic((api) => api.GET('/api/v1/settings/public')),
    loadPublic((api) => api.GET('/api/v1/categories')),
    loadPublic((api) =>
      api.GET('/api/v1/services', { params: { query: { pageSize: 100, sort: 'name' } } }),
    ),
    loadPublic((api) => api.GET('/api/v1/staff')),
  ]);
  if (!settings.data || !categories.data || !services.data || !stylists.data) return null;
  return {
    settings: settings.data,
    categories: categories.data,
    services: services.data.data,
    stylists: stylists.data,
  };
}

export async function loadReviews(filter: { staffId: string } | { serviceId: string }) {
  const result = await loadPublic((api) =>
    api.GET('/api/v1/reviews', { params: { query: { ...filter, pageSize: 10 } } }),
  );
  return result.data?.data ?? [];
}
