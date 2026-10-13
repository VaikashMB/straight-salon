import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og/card';
import { PAGE_OG } from '@/lib/og/pages';

// Share image for every page without its own (the home page's) (05 §2).
export const alt = 'Straight Salon: look sharp, book in under a minute';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(PAGE_OG.home);
}
