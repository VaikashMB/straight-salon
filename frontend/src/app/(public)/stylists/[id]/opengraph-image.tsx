import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og/card';
import { stylistOg } from '@/lib/og/pages';
import { loadPublic } from '@/lib/api/server';

// Share image for one stylist (05 §2): their portrait, name and rating. Falls back to the team
// card when the API cannot answer.
export const alt = 'A stylist at Straight Salon';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stylist = await loadPublic((api) =>
    api.GET('/api/v1/staff/{id}', { params: { path: { id } } }),
  );
  return renderOgImage(stylistOg(stylist.data));
}
