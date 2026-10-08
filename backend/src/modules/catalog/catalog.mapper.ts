import { trimChar, trimEndChar } from '../../shared/text/strings.js';
import type { CategoryDoc, ServiceDoc } from './catalog.model.js';
import type { CategoryDto, ServiceDto } from './catalog.schemas.js';

export function toCategoryDto(category: CategoryDoc): CategoryDto {
  const dto: CategoryDto = {
    id: category._id.toHexString(),
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
  };
  if (category.description) dto.description = category.description;
  return dto;
}

// Prices go out as Money in the salon currency (04 §1).
export function toServiceDto(service: ServiceDoc, currency: string): ServiceDto {
  const dto: ServiceDto = {
    id: service._id.toHexString(),
    slug: service.slug,
    name: service.name,
    categoryId: service.categoryId.toHexString(),
    durationMin: service.durationMin,
    price: { amountMinor: service.priceMinor, currency },
    isActive: service.isActive,
    ratingAvg: service.ratingAvg,
    ratingCount: service.ratingCount,
  };
  if (service.description) dto.description = service.description;
  if (service.imageUrl) dto.imageUrl = service.imageUrl;
  return dto;
}

export const categoryAuditView = (c: CategoryDoc): Record<string, unknown> => ({
  name: c.name,
  slug: c.slug,
  description: c.description ?? null,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
});

export const serviceAuditView = (s: ServiceDoc): Record<string, unknown> => ({
  name: s.name,
  slug: s.slug,
  categoryId: s.categoryId.toHexString(),
  description: s.description ?? null,
  durationMin: s.durationMin,
  priceMinor: s.priceMinor,
  imageUrl: s.imageUrl ?? null,
  isActive: s.isActive,
});

// "Hair Colour (Global)" -> "hair-colour-global"
export function slugify(name: string): string {
  const dashed = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const slug = trimEndChar(trimChar(dashed, '-').slice(0, 100), '-');
  return slug || 'item';
}

// First free slug among base, base-2, base-3, ... given the ones already taken.
export function nextFreeSlug(base: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
