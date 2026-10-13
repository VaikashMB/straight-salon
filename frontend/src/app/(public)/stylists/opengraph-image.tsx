import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og/card';
import { PAGE_OG } from '@/lib/og/pages';

// Share image for the team page (05 §2).
export const alt = 'Meet the Straight Salon stylists';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(PAGE_OG.stylists);
}
