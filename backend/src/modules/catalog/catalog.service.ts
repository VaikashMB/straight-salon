import { randomUUID } from 'node:crypto';
import { Types, type ClientSession, type Connection } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { AuthContext } from '../../shared/auth/accessToken.js';
import { assertPermission, canDo } from '../../shared/auth/middleware.js';
import type { Cache } from '../../shared/cache/cache.js';
import { cacheKeys, cacheTags } from '../../shared/cache/keys.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import { paginated, parseSort, skipFor, type Paginated } from '../../shared/http/pagination.js';
import { processImage } from '../../shared/storage/image.js';
import type { ObjectStorage } from '../../shared/storage/objectStorage.js';
import type { SettingsService } from '../settings/settings.service.js';
import {
  categoryAuditView,
  nextFreeSlug,
  serviceAuditView,
  slugify,
  toCategoryDto,
  toServiceDto,
} from './catalog.mapper.js';
import type { CategoryDoc, ServiceDoc } from './catalog.model.js';
import type { CatalogRepository, CategoryChanges, ServiceChanges } from './catalog.repository.js';
import type {
  CategoryDto,
  CreateCategoryBody,
  CreateServiceBody,
  ListCategoriesQuery,
  ListServicesQuery,
  ServiceDetailDto,
  ServiceDto,
  StylistSummaryDto,
  UpdateCategoryBody,
  UpdateServiceBody,
  UploadedImageDto,
} from './catalog.schemas.js';

// Catalog module public interface (categories, services, image uploads). Public reads are
// cached (08 §2); every change invalidates the `catalog` tag after commit.

export interface CatalogService {
  listCategories(query: ListCategoriesQuery, viewer?: AuthContext): Promise<CategoryDto[]>;
  createCategory(body: CreateCategoryBody): Promise<CategoryDto>;
  updateCategory(id: string, body: UpdateCategoryBody): Promise<CategoryDto>;
  deactivateCategory(id: string): Promise<void>;
  listServices(query: ListServicesQuery, viewer?: AuthContext): Promise<Paginated<ServiceDto>>;
  getService(idOrSlug: string, viewer?: AuthContext): Promise<ServiceDetailDto>;
  createService(body: CreateServiceBody): Promise<ServiceDto>;
  updateService(id: string, body: UpdateServiceBody): Promise<ServiceDto>;
  deactivateService(id: string): Promise<void>;
  uploadImage(file: Buffer): Promise<UploadedImageDto>;
  // For other modules
  activeServiceDurations(): Promise<{ name: string; durationMin: number }[]>;
  findServices(ids: string[]): Promise<ServiceDto[]>; // any status, sorted by name
}

// Implemented by the staff module; passed in to avoid a catalog <-> staff import cycle.
export interface StylistDirectory {
  forService(serviceId: string): Promise<StylistSummaryDto[]>;
}

export interface CatalogServiceDeps {
  repository: CatalogRepository;
  audit: AuditService;
  outbox: Outbox;
  cache: Cache;
  connection: Connection;
  settings: Pick<SettingsService, 'get'>;
  stylists: StylistDirectory;
  storage: ObjectStorage;
  newId?: () => string;
}

const TTL = { categories: 1800, services: 600, service: 1800 }; // 08 §2
const SORTABLE = ['name', 'durationMin', 'priceMinor', 'createdAt'] as const;

const asObjectId = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

export function createCatalogService(deps: CatalogServiceDeps): CatalogService {
  const { repository, audit, outbox, cache, connection, settings, stylists, storage } = deps;
  const newId = deps.newId ?? randomUUID;

  const currency = async () => (await settings.get()).currency;

  async function requireCategory(id: string): Promise<CategoryDoc> {
    const objectId = asObjectId(id);
    const category = objectId ? await repository.findCategoryById(objectId) : null;
    if (!category) throw new NotFoundError('Category not found.');
    return category;
  }

  async function requireService(id: string): Promise<ServiceDoc> {
    const objectId = asObjectId(id);
    const service = objectId ? await repository.findServiceById(objectId) : null;
    if (!service) throw new NotFoundError('Service not found.');
    return service;
  }

  async function assertCategoryExists(id: string): Promise<void> {
    const objectId = asObjectId(id);
    if (!objectId || !(await repository.findCategoryById(objectId))) {
      throw new ValidationError('The request is invalid.', [
        { path: 'categoryId', message: 'Category not found' },
      ]);
    }
  }

  // BR-013
  async function assertDurationFits(durationMin: number): Promise<void> {
    const { slotGranularityMin } = await settings.get();
    if (durationMin % slotGranularityMin !== 0) {
      throw new BusinessRuleError(
        'INVALID_DURATION',
        `Duration must be a multiple of ${slotGranularityMin} minutes.`,
        [{ path: 'durationMin', message: `Not a multiple of ${slotGranularityMin}` }],
      );
    }
  }

  async function assertActiveNameFree(name: string, exceptId?: Types.ObjectId): Promise<void> {
    const existing = await repository.findActiveServiceByName(name);
    if (existing && !(exceptId && existing._id.equals(exceptId))) {
      throw new ConflictError('An active service with this name already exists.');
    }
  }

  // EVT-031
  async function catalogChanged(
    session: ClientSession,
    entityType: 'category' | 'service',
    entityId: string,
  ): Promise<void> {
    await outbox.add(session, {
      type: 'catalog.changed',
      aggregateType: entityType,
      aggregateId: entityId,
      payload: { entityType, entityId },
    });
  }

  // 08 §4: synchronous invalidation after commit (the cache-invalidation consumer repeats it).
  // Staff entries embed service data, so they go too.
  async function invalidate(): Promise<void> {
    await cache.invalidateTag(cacheTags.catalog);
    await cache.invalidateTag(cacheTags.staff);
  }

  async function applyCategoryChange(
    category: CategoryDoc,
    changes: CategoryChanges,
  ): Promise<CategoryDoc> {
    const action = changes.isActive === false ? 'category.deactivate' : 'category.update';
    const updated = await withTransaction(connection, async (session) => {
      const next = await repository.updateCategory(category._id, changes, session);
      if (!next) throw new NotFoundError('Category not found.');
      await audit.record(
        {
          action,
          entityType: 'category',
          entityId: category._id.toHexString(),
          before: categoryAuditView(category),
          after: categoryAuditView(next),
        },
        session,
      );
      await catalogChanged(session, 'category', category._id.toHexString());
      return next;
    });
    await invalidate();
    return updated;
  }

  async function applyServiceChange(
    service: ServiceDoc,
    changes: ServiceChanges,
  ): Promise<ServiceDoc> {
    const action = changes.isActive === false ? 'service.deactivate' : 'service.update';
    const updated = await withTransaction(connection, async (session) => {
      const next = await repository.updateService(service._id, service.__v, changes, session);
      await audit.record(
        {
          action,
          entityType: 'service',
          entityId: service._id.toHexString(),
          before: serviceAuditView(service),
          after: serviceAuditView(next),
        },
        session,
      );
      await catalogChanged(session, 'service', service._id.toHexString());
      return next;
    });
    await invalidate();
    return updated;
  }

  async function loadServiceDetail(service: ServiceDoc): Promise<ServiceDetailDto> {
    const [money, team] = await Promise.all([
      currency(),
      stylists.forService(service._id.toHexString()),
    ]);
    return { ...toServiceDto(service, money), stylists: team };
  }

  return {
    async listCategories(query, viewer) {
      if (query.includeInactive) {
        assertPermission(viewer, 'catalog:manage');
        return (await repository.listCategories(true)).map(toCategoryDto);
      }
      return cache.cacheAside(
        cacheKeys.categories(),
        TTL.categories,
        async () => (await repository.listCategories(false)).map(toCategoryDto),
        { tags: [cacheTags.catalog] },
      );
    },

    async createCategory(body) {
      if (await repository.findCategoryByName(body.name)) {
        throw new ConflictError('A category with this name already exists.');
      }
      const base = slugify(body.name);
      const slug = nextFreeSlug(base, await repository.categorySlugsLike(base));
      const created = await withTransaction(connection, async (session) => {
        const category = await repository.createCategory(
          {
            name: body.name,
            slug,
            sortOrder: body.sortOrder ?? 0,
            ...(body.description ? { description: body.description } : {}),
          },
          session,
        );
        await audit.record(
          {
            action: 'category.create',
            entityType: 'category',
            entityId: category._id.toHexString(),
            before: null,
            after: categoryAuditView(category),
          },
          session,
        );
        await catalogChanged(session, 'category', category._id.toHexString());
        return category;
      });
      await invalidate();
      return toCategoryDto(created);
    },

    async updateCategory(id, body) {
      const category = await requireCategory(id);
      if (body.name !== undefined && body.name !== category.name) {
        if (await repository.findCategoryByName(body.name)) {
          throw new ConflictError('A category with this name already exists.');
        }
      }
      const changes: CategoryChanges = {};
      if (body.name !== undefined && body.name !== category.name) changes.name = body.name;
      if (body.description !== undefined && body.description !== (category.description ?? null))
        changes.description = body.description || null;
      if (body.sortOrder !== undefined && body.sortOrder !== category.sortOrder)
        changes.sortOrder = body.sortOrder;
      if (body.isActive !== undefined && body.isActive !== category.isActive)
        changes.isActive = body.isActive;
      if (Object.keys(changes).length === 0) return toCategoryDto(category);
      return toCategoryDto(await applyCategoryChange(category, changes));
    },

    async deactivateCategory(id) {
      const category = await requireCategory(id);
      if (category.isActive) await applyCategoryChange(category, { isActive: false });
    },

    async listServices(query, viewer) {
      const load = async (includeInactive: boolean) => {
        const result = await repository.searchServices({
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.q ? { q: query.q } : {}),
          includeInactive,
          skip: skipFor(query),
          limit: query.pageSize,
          sort: parseSort(query.sort, SORTABLE, { name: 1 }),
        });
        const money = await currency();
        return paginated(
          result.data.map((s) => toServiceDto(s, money)),
          result.total,
          query,
        );
      };
      if (query.includeInactive) {
        assertPermission(viewer, 'catalog:manage');
        return load(true);
      }
      const cacheable = {
        categoryId: query.categoryId,
        q: query.q,
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
      };
      return cache.cacheAside(cacheKeys.services(cacheable), TTL.services, () => load(false), {
        tags: [cacheTags.catalog],
      });
    },

    async getService(idOrSlug, viewer) {
      const find = () => {
        const objectId = /^[a-f\d]{24}$/i.test(idOrSlug) ? asObjectId(idOrSlug) : null;
        return objectId
          ? repository.findServiceById(objectId)
          : repository.findServiceBySlug(idOrSlug.toLowerCase());
      };
      // Admins also see deactivated services, uncached.
      if (canDo(viewer, 'catalog:manage')) {
        const service = await find();
        if (!service) throw new NotFoundError('Service not found.');
        return loadServiceDetail(service);
      }
      const detail = await cache.cacheAside(
        cacheKeys.service(idOrSlug.toLowerCase()),
        TTL.service,
        async () => {
          const service = await find();
          return service?.isActive ? loadServiceDetail(service) : null;
        },
        { tags: [cacheTags.catalog, cacheTags.staff] },
      );
      if (!detail) throw new NotFoundError('Service not found.');
      return detail;
    },

    async createService(body) {
      await assertCategoryExists(body.categoryId);
      await assertDurationFits(body.durationMin);
      const isActive = body.isActive ?? true;
      if (isActive) await assertActiveNameFree(body.name);
      const base = slugify(body.name);
      const slug = nextFreeSlug(base, await repository.serviceSlugsLike(base));

      const created = await withTransaction(connection, async (session) => {
        const service = await repository.createService(
          {
            name: body.name,
            slug,
            categoryId: new Types.ObjectId(body.categoryId),
            durationMin: body.durationMin,
            priceMinor: body.priceMinor,
            isActive,
            ...(body.description ? { description: body.description } : {}),
            ...(body.imageUrl ? { imageUrl: body.imageUrl } : {}),
          },
          session,
        );
        await audit.record(
          {
            action: 'service.create',
            entityType: 'service',
            entityId: service._id.toHexString(),
            before: null,
            after: serviceAuditView(service),
          },
          session,
        );
        await catalogChanged(session, 'service', service._id.toHexString());
        return service;
      });
      await invalidate();
      return toServiceDto(created, await currency());
    },

    async updateService(id, body) {
      const service = await requireService(id);
      const changes: ServiceChanges = {};
      if (body.name !== undefined && body.name !== service.name) changes.name = body.name;
      if (body.categoryId !== undefined && body.categoryId !== service.categoryId.toHexString()) {
        await assertCategoryExists(body.categoryId);
        changes.categoryId = new Types.ObjectId(body.categoryId);
      }
      if (body.description !== undefined && body.description !== (service.description ?? null))
        changes.description = body.description || null;
      if (body.durationMin !== undefined && body.durationMin !== service.durationMin)
        changes.durationMin = body.durationMin;
      if (body.priceMinor !== undefined && body.priceMinor !== service.priceMinor)
        changes.priceMinor = body.priceMinor;
      if (body.imageUrl !== undefined && body.imageUrl !== (service.imageUrl ?? null))
        changes.imageUrl = body.imageUrl;
      if (body.isActive !== undefined && body.isActive !== service.isActive)
        changes.isActive = body.isActive;
      if (Object.keys(changes).length === 0) return toServiceDto(service, await currency());

      // An active result must satisfy BR-013 and the unique-active-name rule; a reactivated
      // service is re-checked because settings may have changed while it was inactive.
      const activeAfter = changes.isActive ?? service.isActive;
      if (activeAfter) {
        if (changes.durationMin !== undefined || changes.isActive === true)
          await assertDurationFits(changes.durationMin ?? service.durationMin);
        if (changes.name !== undefined || changes.isActive === true)
          await assertActiveNameFree(changes.name ?? service.name, service._id);
      }
      return toServiceDto(await applyServiceChange(service, changes), await currency());
    },

    async deactivateService(id) {
      const service = await requireService(id);
      if (service.isActive) await applyServiceChange(service, { isActive: false });
    },

    async uploadImage(file) {
      const image = await processImage(file);
      const stored = await storage.put(
        `images/${newId()}.${image.ext}`,
        image.buffer,
        image.contentType,
      );
      return { url: stored.url };
    },

    async activeServiceDurations() {
      return (await repository.listActiveServices()).map((s) => ({
        name: s.name,
        durationMin: s.durationMin,
      }));
    },

    async findServices(ids) {
      const valid = ids.filter((id) => Types.ObjectId.isValid(id));
      if (valid.length === 0) return [];
      const money = await currency();
      return (await repository.findServicesByIds(valid)).map((s) => toServiceDto(s, money));
    },
  };
}
