import type { components } from '@/lib/api/schema';
import { formatMinutes } from '@/lib/time';
import type { OgCardProps } from './card';

// What each page's share image says (05 §2). The last photo of every list is a studio photo,
// the fallback when a service's or stylist's own picture cannot be read.

export type OgContent = Omit<OgCardProps, 'photo'> & { photos: (string | undefined)[] };

const STUDIO = '/salon/a.webp';

export const PAGE_OG = {
  home: {
    eyebrow: 'Hair · Beard · Skin · Nails',
    title: 'Look sharp.',
    em: 'Book in under a minute.',
    subtitle: 'Choose your services, pick a stylist and grab a time that suits you.',
    photos: [STUDIO],
  },
  services: {
    eyebrow: 'The menu',
    title: 'Services & prices',
    em: 'Cut, colour, care.',
    subtitle: 'Every service with its time and price, ready to book online.',
    photos: ['/looks/haircut.webp', STUDIO],
  },
  stylists: {
    eyebrow: 'The team',
    title: 'Meet our stylists',
    em: 'Pick yours, or let us match you.',
    photos: ['/demo/staff/priya.webp', STUDIO],
  },
  gallery: {
    eyebrow: 'Lookbook',
    title: 'Signature looks',
    em: 'Find your next cut.',
    subtitle: 'Fades, colour, curls and nails from the studio.',
    photos: ['/gallery/soft-waves.webp', STUDIO],
  },
  location: {
    eyebrow: 'Visit us',
    title: 'Find the studio',
    em: 'See you in the chair.',
    subtitle: 'Address, opening hours and directions.',
    photos: ['/salon/c.webp', STUDIO],
  },
  book: {
    eyebrow: 'Book online',
    title: 'Book your visit',
    em: 'Pay at the salon.',
    subtitle: 'Services, stylist, time: done in under a minute.',
    photos: ['/salon/b.webp', STUDIO],
  },
} satisfies Record<string, OgContent>;

export type OgPage = keyof typeof PAGE_OG;

// "Rated 4.8 by 32 guests", or nothing before the first review.
export function ratingLine(avg: number, count: number): string | null {
  if (count === 0) return null;
  return `Rated ${avg.toFixed(1)} by ${count} ${count === 1 ? 'guest' : 'guests'}`;
}

type Service = components['schemas']['Service'];
type Stylist = Pick<
  components['schemas']['Staff'],
  'displayName' | 'bio' | 'photoUrl' | 'ratingAvg' | 'ratingCount'
>;

export function serviceOg(service: Service | null, categoryName?: string): OgContent {
  if (!service) return { ...PAGE_OG.services, photos: PAGE_OG.services.photos };
  const rating = ratingLine(service.ratingAvg, service.ratingCount);
  return {
    eyebrow: categoryName ?? 'Service',
    title: service.name,
    subtitle: [formatMinutes(service.durationMin), rating].filter(Boolean).join(' · '),
    photos: [service.imageUrl, STUDIO],
  };
}

export function stylistOg(stylist: Stylist | null): OgContent {
  if (!stylist) return { ...PAGE_OG.stylists, photos: PAGE_OG.stylists.photos };
  return {
    eyebrow: 'Stylist',
    title: stylist.displayName,
    em: `Book with ${stylist.displayName.split(/\s+/)[0] ?? stylist.displayName}.`,
    subtitle: ratingLine(stylist.ratingAvg, stylist.ratingCount) ?? stylist.bio,
    photos: [stylist.photoUrl, STUDIO],
  };
}
