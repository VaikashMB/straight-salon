import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og/card';
import { serviceOg } from '@/lib/og/pages';
import { loadPublic } from '@/lib/api/server';

// Share image for one service (05 §2): its photo, name, category, time and rating. Falls back
// to the services menu card when the API cannot answer.
export const alt = 'A service at Straight Salon';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [service, categories] = await Promise.all([
    loadPublic((api) =>
      api.GET('/api/v1/services/{idOrSlug}', { params: { path: { idOrSlug: slug } } }),
    ),
    loadPublic((api) => api.GET('/api/v1/categories')),
  ]);
  const category = categories.data?.find((c) => c.id === service.data?.categoryId);
  return renderOgImage(serviceOg(service.data, category?.name));
}
