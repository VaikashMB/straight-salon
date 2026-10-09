import { Brush, Droplets, Hand, Scissors, Sparkles } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  categoryStyle,
  FALLBACK_CATEGORY_STYLE,
  stylistSpecialities,
} from '@/features/catalog/category-style';
import { categories, ids, makeCategory, services } from '../../helpers/fixtures';

describe('category style (decorative identity per category)', () => {
  it.each([
    ['hair', 'Hair', Scissors],
    ['beard-grooming', 'Beard & Grooming', Brush],
    ['skin', 'Skin', Droplets],
    ['nails', 'Nails', Hand],
  ])('the seeded category %s gets its own icon and tint', (slug, name, icon) => {
    const style = categoryStyle({ slug, name });
    expect(style.icon).toBe(icon);
    expect(style.tint).not.toBe(FALLBACK_CATEGORY_STYLE.tint);
  });

  it('falls back to the name when the slug was changed', () => {
    expect(categoryStyle({ slug: 'cat-7', name: 'Hair & Colour' }).icon).toBe(Scissors);
    expect(categoryStyle({ slug: 'nails-2', name: 'Manicure' }).icon).toBe(Hand);
  });

  it('categories added by admins, and a missing category, get the brass fallback', () => {
    expect(categoryStyle({ slug: 'massage', name: 'Massage' })).toBe(FALLBACK_CATEGORY_STYLE);
    expect(categoryStyle(undefined)).toBe(FALLBACK_CATEGORY_STYLE);
    expect(FALLBACK_CATEGORY_STYLE.icon).toBe(Sparkles);
  });
});

describe('stylist specialities', () => {
  it('lists the categories of the services a stylist performs, in menu order', () => {
    const reordered = [...categories].reverse();
    expect(
      stylistSpecialities({ serviceIds: [ids.beardTrim, ids.haircut] }, services, reordered),
    ).toEqual(['Hair', 'Beard & Grooming']);
    expect(stylistSpecialities({ serviceIds: [ids.colour] }, services, categories)).toEqual([
      'Hair',
    ]);
  });

  it('is empty when none of their services are in the catalogue', () => {
    expect(stylistSpecialities({ serviceIds: ['unknown'] }, services, [makeCategory()])).toEqual(
      [],
    );
  });
});
