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

// Testimonials for the home page: the most recent visible reviews with a comment and four or
// five stars, at most `limit` of them.
export async function loadFeaturedReviews(limit = 3): Promise<Review[]> {
  const result = await loadPublic((api) =>
    api.GET('/api/v1/reviews', { params: { query: { pageSize: 30 } } }),
  );
  return (result.data?.data ?? [])
    .filter((review) => review.rating >= 4 && review.comment)
    .slice(0, limit);
}

// Salon-wide figures for the home hero, from the stylists' rating aggregates (every review rates
// one stylist). null rating when nothing has been rated yet.
export function salonStats(catalogue: Catalogue): {
  rating: number | null;
  reviews: number;
  services: number;
  stylists: number;
} {
  const reviews = catalogue.stylists.reduce((sum, s) => sum + s.ratingCount, 0);
  const weighted = catalogue.stylists.reduce((sum, s) => sum + s.ratingAvg * s.ratingCount, 0);
  return {
    rating: reviews > 0 ? Math.round((weighted / reviews) * 10) / 10 : null,
    reviews,
    services: catalogue.services.length,
    stylists: catalogue.stylists.length,
  };
}
