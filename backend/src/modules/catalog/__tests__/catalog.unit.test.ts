import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { nextFreeSlug, slugify, toCategoryDto, toServiceDto } from '../catalog.mapper.js';
import type { ServiceDoc } from '../catalog.model.js';
import { serviceSearchFilter } from '../catalog.repository.js';
import {
  CreateServiceBodySchema,
  ServiceParamsSchema,
  UpdateCategoryBodySchema,
  UpdateServiceBodySchema,
} from '../catalog.schemas.js';

describe('slugs', () => {
  it('slugify makes URL-safe, lowercase slugs', () => {
    expect(slugify('Hair Colour (Global)')).toBe('hair-colour-global');
    expect(slugify('Beard & Grooming')).toBe('beard-grooming');
    expect(slugify('  Crème Brûlée Facial  ')).toBe('creme-brulee-facial');
    expect(slugify('***')).toBe('item');
    expect(slugify('a'.repeat(150))).toHaveLength(100);
  });

  it('nextFreeSlug appends the first free number', () => {
    expect(nextFreeSlug('haircut', [])).toBe('haircut');
    expect(nextFreeSlug('haircut', ['haircut'])).toBe('haircut-2');
    expect(nextFreeSlug('haircut', ['haircut', 'haircut-2', 'haircut-3'])).toBe('haircut-4');
  });
});

describe('catalog mapper', () => {
  const service: ServiceDoc = {
    _id: new Types.ObjectId('6712c0f9a1b2c3d4e5f60501'),
    name: 'Haircut',
    slug: 'haircut',
    categoryId: new Types.ObjectId('6712c0f9a1b2c3d4e5f60401'),
    durationMin: 45,
    priceMinor: 40_000,
    isActive: true,
    ratingAvg: 0,
    ratingCount: 0,
    __v: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('prices go out as Money in the salon currency (04 §1)', () => {
    const dto = toServiceDto(service, 'INR');
    expect(dto).toMatchObject({ price: { amountMinor: 40_000, currency: 'INR' }, durationMin: 45 });
    expect(dto).not.toHaveProperty('description');
    expect(dto).not.toHaveProperty('imageUrl');
    expect(
      toServiceDto({ ...service, imageUrl: 'http://x/y.png', description: 'd' }, 'USD'),
    ).toMatchObject({ imageUrl: 'http://x/y.png', description: 'd', price: { currency: 'USD' } });
  });

  it('omits empty category descriptions', () => {
    const base = {
      _id: new Types.ObjectId(),
      name: 'Hair',
      slug: 'hair',
      sortOrder: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(toCategoryDto(base)).not.toHaveProperty('description');
    expect(toCategoryDto({ ...base, description: 'Cuts' }).description).toBe('Cuts');
  });
});

describe('catalog schemas', () => {
  const valid = {
    name: 'Haircut',
    categoryId: '6712c0f9a1b2c3d4e5f60401',
    durationMin: 45,
    priceMinor: 40_000,
  };

  it('validates service input', () => {
    expect(CreateServiceBodySchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, priceMinor: 12.5 }, // money is integer minor units
      { ...valid, priceMinor: -1 },
      { ...valid, durationMin: 0 },
      { ...valid, imageUrl: 'javascript:alert(1)' },
      { ...valid, categoryId: 'nope' },
      { ...valid, ratingAvg: 5 }, // mass assignment
    ]) {
      expect(CreateServiceBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('updates need at least one field; null clears optional fields', () => {
    expect(UpdateServiceBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateServiceBodySchema.safeParse({ imageUrl: null, description: null }).success).toBe(
      true,
    );
    expect(UpdateCategoryBodySchema.safeParse({}).success).toBe(false);
  });

  it('service params accept an id or a slug, nothing else', () => {
    expect(ServiceParamsSchema.safeParse({ idOrSlug: 'hair-colour-global' }).success).toBe(true);
    expect(ServiceParamsSchema.safeParse({ idOrSlug: '6712c0f9a1b2c3d4e5f60501' }).success).toBe(
      true,
    );
    expect(ServiceParamsSchema.safeParse({ idOrSlug: 'a b' }).success).toBe(false);
    expect(ServiceParamsSchema.safeParse({ idOrSlug: '../x' }).success).toBe(false);
  });
});

describe('serviceSearchFilter', () => {
  it('public reads only see active services; text search uses the text index', () => {
    expect(serviceSearchFilter({ includeInactive: false })).toEqual({ isActive: true });
    expect(serviceSearchFilter({ includeInactive: true })).toEqual({});
    const filter = serviceSearchFilter({
      includeInactive: false,
      categoryId: '6712c0f9a1b2c3d4e5f60401',
      q: ' cut ',
    }) as Record<string, unknown>;
    expect(String(filter.categoryId)).toBe('6712c0f9a1b2c3d4e5f60401');
    expect(filter.$text).toMatchObject({ $search: 'cut' });
  });
});
