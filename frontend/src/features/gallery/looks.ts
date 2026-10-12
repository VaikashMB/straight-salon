// The lookbook (05 §3 /gallery): finished looks by category. Royalty-free stock photos from
// Unsplash, credited in public/PHOTO-CREDITS.md; they illustrate the kind of work on the menu,
// not this salon's own clients. `service` is a seeded service slug for "Book this look".
// Width and height are the files' real sizes, so the masonry grid reserves space before they load.

export type LookCategory = 'hair' | 'beard' | 'nails';

export interface Look {
  src: string;
  title: string;
  alt: string;
  category: LookCategory;
  service?: string;
  width: number;
  height: number;
}

export const LOOK_CATEGORIES: { value: LookCategory; label: string }[] = [
  { value: 'hair', label: 'Hair' },
  { value: 'beard', label: 'Beard & grooming' },
  { value: 'nails', label: 'Nails' },
];

export const LOOKS: Look[] = [
  {
    src: '/gallery/pompadour-fade.webp',
    title: 'Pompadour fade',
    alt: 'A man with a high pompadour, skin fade and trimmed beard',
    category: 'hair',
    service: 'haircut',
    width: 900,
    height: 1374,
  },
  {
    src: '/gallery/balayage.webp',
    title: 'Sunlit balayage',
    alt: 'Two heads of long wavy hair in blonde and honey balayage',
    category: 'hair',
    service: 'hair-colour-global',
    width: 900,
    height: 900,
  },
  {
    src: '/gallery/full-beard.webp',
    title: 'Sculpted full beard',
    alt: 'Profile of a man with a full, shaped beard and a short fade',
    category: 'beard',
    service: 'beard-styling',
    width: 900,
    height: 1350,
  },
  {
    src: '/gallery/navy-gold-nails.webp',
    title: 'Navy and gold',
    alt: 'Hands with almond nails painted navy, gold and white',
    category: 'nails',
    service: 'gel-polish',
    width: 900,
    height: 1125,
  },
  {
    src: '/gallery/copper-updo.webp',
    title: 'Copper updo',
    alt: 'A stylist finishing a braided copper-red updo',
    category: 'hair',
    service: 'wash-and-blow-dry',
    width: 900,
    height: 600,
  },
  {
    src: '/gallery/shaved-design.webp',
    title: 'Shaved design',
    alt: 'A barber styling curly hair with a shaved line design',
    category: 'hair',
    service: 'haircut',
    width: 900,
    height: 1352,
  },
  {
    src: '/gallery/sleek-bob.webp',
    title: 'Sleek glossy bob',
    alt: 'The back of a smooth, glossy brown bob',
    category: 'hair',
    service: 'keratin-smoothing',
    width: 900,
    height: 1601,
  },
  {
    src: '/gallery/beard-fade.webp',
    title: 'Beard and taper',
    alt: 'A man in a check shirt with a short beard and a tapered fade',
    category: 'beard',
    service: 'beard-trim',
    width: 900,
    height: 1200,
  },
  {
    src: '/gallery/tortoiseshell-nails.webp',
    title: 'Tortoiseshell',
    alt: 'Hand with black and tortoiseshell nails and a gold ring',
    category: 'nails',
    service: 'gel-polish',
    width: 900,
    height: 1350,
  },
  {
    src: '/gallery/soft-waves.webp',
    title: 'Soft waves',
    alt: 'A smiling woman with long, soft brown waves',
    category: 'hair',
    service: 'wash-and-blow-dry',
    width: 900,
    height: 600,
  },
  {
    src: '/gallery/textured-crop.webp',
    title: 'Textured crop',
    alt: 'A barber thinning the top of a textured crop with shears and comb',
    category: 'hair',
    service: 'haircut',
    width: 900,
    height: 1350,
  },
  {
    src: '/gallery/twists.webp',
    title: 'Two-tone twists',
    alt: 'Dark twists with brown ends, seen from above',
    category: 'hair',
    service: 'hair-spa',
    width: 900,
    height: 596,
  },
  {
    src: '/gallery/slick-back.webp',
    title: 'Classic slick back',
    alt: 'A man with a slicked-back cut in a dim barbershop',
    category: 'hair',
    service: 'haircut',
    width: 900,
    height: 1350,
  },
  {
    src: '/gallery/curls.webp',
    title: 'Glossy curls',
    alt: 'A stylist shaping long brown hair into glossy curls with an iron',
    category: 'hair',
    service: 'wash-and-blow-dry',
    width: 900,
    height: 1602,
  },
  {
    src: '/gallery/classic-cut.webp',
    title: 'Gentleman’s cut',
    alt: 'A barber in braces and a hat cutting a client’s side part',
    category: 'hair',
    service: 'haircut',
    width: 900,
    height: 1350,
  },
  {
    src: '/gallery/kids-curls.webp',
    title: 'Kids’ curly top',
    alt: 'A boy in a red barber cape with a curly textured cut',
    category: 'hair',
    service: 'kids-haircut',
    width: 900,
    height: 1352,
  },
  {
    src: '/gallery/pin-curls.webp',
    title: 'Pin-curl set',
    alt: 'A stylist setting long hair into rolled pin curls',
    category: 'hair',
    service: 'wash-and-blow-dry',
    width: 900,
    height: 600,
  },
  {
    src: '/gallery/braid.webp',
    title: 'Loose braid',
    alt: 'A loose, textured braid in light brown hair',
    category: 'hair',
    service: 'wash-and-blow-dry',
    width: 900,
    height: 599,
  },
];

export const isLookCategory = (value: unknown): value is LookCategory =>
  LOOK_CATEGORIES.some((c) => c.value === value);

// Looks in a category (all of them without one).
export function looksIn(category?: LookCategory): Look[] {
  return category ? LOOKS.filter((l) => l.category === category) : LOOKS;
}

// Up to `limit` looks for a stylist, from the categories they work in (by category slug or
// name, like category-style.ts), so a barber shows cuts and beards, a nail tech shows nails.
export function looksForCategories(categoryKeys: string[], limit = 6): Look[] {
  const wanted = new Set<LookCategory>();
  for (const key of categoryKeys.map((k) => k.toLowerCase())) {
    for (const c of LOOK_CATEGORIES) if (key.startsWith(c.value)) wanted.add(c.value);
  }
  return LOOKS.filter((l) => wanted.has(l.category)).slice(0, limit);
}
