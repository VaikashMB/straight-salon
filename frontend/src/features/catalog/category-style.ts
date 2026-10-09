import { Brush, Droplets, Hand, Scissors, Sparkles, type LucideIcon } from 'lucide-react';
import type { Category, Service, Stylist } from './api';

// Visual identity per service category: an icon and a soft tint for card headers and image
// placeholders. Keyed by the seeded category slugs; categories admins add later get the brass
// fallback. Purely decorative: the category name is always shown as text next to it.

export interface CategoryStyle {
  icon: LucideIcon;
  // Background tint for a header or placeholder (light and dark).
  tint: string;
  // Icon colour on that tint.
  ink: string;
}

// Warm tones that sit with the brass palette (05 §2): brass, taupe, terracotta, sage.
const STYLES: Record<string, CategoryStyle> = {
  hair: {
    icon: Scissors,
    tint: 'bg-[#f0e2c8] dark:bg-[#33291a]',
    ink: 'text-accent-ink',
  },
  beard: {
    icon: Brush,
    tint: 'bg-[#ebe5dc] dark:bg-[#2a2722]',
    ink: 'text-[#5c574f] dark:text-[#cfc6b8]',
  },
  skin: {
    icon: Droplets,
    tint: 'bg-[#f4e4da] dark:bg-[#2e221d]',
    ink: 'text-[#8a4f3a] dark:text-[#e3a98f]',
  },
  nails: {
    icon: Hand,
    tint: 'bg-[#e6e8dc] dark:bg-[#23261d]',
    ink: 'text-[#56613f] dark:text-[#b8c49a]',
  },
};

export const FALLBACK_CATEGORY_STYLE: CategoryStyle = {
  icon: Sparkles,
  tint: 'bg-accent-soft',
  ink: 'text-accent-ink',
};

// Same shape as the API's slugs ("Beard & Grooming" -> "beard-grooming").
const toSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Matches on the slug, then the name, so a renamed slug ("hair-2") or a tweaked name still
// finds its style: "beard-grooming" matches the "beard" key.
export function categoryStyle(category?: Pick<Category, 'slug' | 'name'>): CategoryStyle {
  if (!category) return FALLBACK_CATEGORY_STYLE;
  for (const candidate of [category.slug, toSlug(category.name)]) {
    const key = Object.keys(STYLES).find((k) => candidate === k || candidate.startsWith(`${k}-`));
    if (key) return STYLES[key]!;
  }
  return FALLBACK_CATEGORY_STYLE;
}

// The categories a stylist works in, in menu order, from the services they perform. Shown as
// "speciality" chips on their card.
export function stylistSpecialities(
  stylist: Pick<Stylist, 'serviceIds'>,
  services: Pick<Service, 'id' | 'categoryId'>[],
  categories: Category[],
): string[] {
  const categoryIds = new Set(
    services.filter((s) => stylist.serviceIds.includes(s.id)).map((s) => s.categoryId),
  );
  return [...categories]
    .filter((c) => categoryIds.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => c.name);
}
