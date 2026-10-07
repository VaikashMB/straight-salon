import mongoose, { Types, type ClientSession, type QueryFilter } from 'mongoose';
import { ConflictError } from '../../shared/errors/index.js';
import { CategoryModel, ServiceModel, type CategoryDoc, type ServiceDoc } from './catalog.model.js';

// All Mongoose access for categories and services. Operator objects written here are wrapped
// in trusted() because sanitizeFilter is on (06 §4); user input is never wrapped.

export interface NewCategory {
  name: string;
  slug: string;
  description?: string;
  sortOrder: number;
}

export interface CategoryChanges {
  name?: string;
  description?: string | null; // null clears it
  sortOrder?: number;
  isActive?: boolean;
}

export interface NewService {
  name: string;
  slug: string;
  categoryId: Types.ObjectId;
  description?: string;
  durationMin: number;
  priceMinor: number;
  imageUrl?: string;
  isActive: boolean;
}

export interface ServiceChanges {
  name?: string;
  categoryId?: Types.ObjectId;
  description?: string | null;
  durationMin?: number;
  priceMinor?: number;
  imageUrl?: string | null;
  isActive?: boolean;
}

export interface ServiceSearch {
  categoryId?: string;
  q?: string;
  includeInactive: boolean;
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

export interface CatalogRepository {
  listCategories(includeInactive: boolean): Promise<CategoryDoc[]>;
  findCategoryById(id: string | Types.ObjectId): Promise<CategoryDoc | null>;
  findCategoryByName(name: string): Promise<CategoryDoc | null>;
  createCategory(category: NewCategory, session?: ClientSession): Promise<CategoryDoc>;
  updateCategory(
    id: Types.ObjectId,
    changes: CategoryChanges,
    session?: ClientSession,
  ): Promise<CategoryDoc | null>;
  categorySlugsLike(base: string): Promise<string[]>;

  searchServices(search: ServiceSearch): Promise<{ data: ServiceDoc[]; total: number }>;
  findServiceById(id: string | Types.ObjectId): Promise<ServiceDoc | null>;
  findServiceBySlug(slug: string): Promise<ServiceDoc | null>;
  findActiveServiceByName(name: string): Promise<ServiceDoc | null>;
  findServicesByIds(ids: (string | Types.ObjectId)[]): Promise<ServiceDoc[]>;
  listActiveServices(): Promise<ServiceDoc[]>;
  createService(service: NewService, session?: ClientSession): Promise<ServiceDoc>;
  // Optimistic concurrency (02 §1): 409 STALE_VERSION if the service changed since it was read.
  updateService(
    id: Types.ObjectId,
    expectedVersion: number,
    changes: ServiceChanges,
    session?: ClientSession,
  ): Promise<ServiceDoc>;
  serviceSlugsLike(base: string): Promise<string[]>;
  // Denormalised rating (FR-061), written by the ratings consumer; does not bump the version.
  setServiceRating(id: Types.ObjectId, ratingAvg: number, ratingCount: number): Promise<void>;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Splits changes into $set / $unset: null means "remove the optional field".
function toUpdate(changes: object): { $set: Record<string, unknown>; $unset: Record<string, 1> } {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) $unset[key] = 1;
    else if (value !== undefined) $set[key] = value;
  }
  return { $set, $unset };
}

// Slugs equal to `base` or `base-<n>`, via the unique { slug } index (anchored prefix regex).
const slugFilter = (base: string) => ({
  slug: mongoose.trusted({ $regex: `^${escapeRegex(base)}(-\\d+)?$` }),
});

export function serviceSearchFilter(
  search: Pick<ServiceSearch, 'categoryId' | 'q' | 'includeInactive'>,
): QueryFilter<ServiceDoc> {
  const filter: QueryFilter<ServiceDoc> = {};
  if (search.categoryId) filter.categoryId = new Types.ObjectId(search.categoryId);
  if (!search.includeInactive) filter.isActive = true;
  const term = search.q?.trim();
  if (term) Object.assign(filter, { $text: mongoose.trusted({ $search: term }) });
  return filter;
}

export const catalogRepository: CatalogRepository = {
  listCategories: (includeInactive) =>
    CategoryModel.find(includeInactive ? {} : { isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean<CategoryDoc[]>(),
  findCategoryById: (id) => CategoryModel.findById(id).lean<CategoryDoc>(),
  findCategoryByName: (name) => CategoryModel.findOne({ name }).lean<CategoryDoc>(),
  async createCategory(category, session) {
    const [created] = await CategoryModel.create([category], { session });
    return created!.toObject();
  },
  updateCategory: (id, changes, session) =>
    CategoryModel.findByIdAndUpdate(id, toUpdate(changes), {
      returnDocument: 'after',
      runValidators: true,
      session,
    }).lean<CategoryDoc>(),
  async categorySlugsLike(base) {
    return (await CategoryModel.find(slugFilter(base), { slug: 1 }).lean()).map((c) => c.slug);
  },

  async searchServices(search) {
    const filter = serviceSearchFilter(search);
    const [data, total] = await Promise.all([
      ServiceModel.find(filter)
        .sort(search.sort)
        .skip(search.skip)
        .limit(search.limit)
        .lean<ServiceDoc[]>(),
      ServiceModel.countDocuments(filter),
    ]);
    return { data, total };
  },
  findServiceById: (id) => ServiceModel.findById(id).lean<ServiceDoc>(),
  findServiceBySlug: (slug) => ServiceModel.findOne({ slug }).lean<ServiceDoc>(),
  findActiveServiceByName: (name) =>
    ServiceModel.findOne({ name, isActive: true }).lean<ServiceDoc>(),
  findServicesByIds: (ids) =>
    ServiceModel.find({ _id: mongoose.trusted({ $in: ids.map((id) => new Types.ObjectId(id)) }) })
      .sort({ name: 1 })
      .lean<ServiceDoc[]>(),
  listActiveServices: () =>
    ServiceModel.find({ isActive: true }).sort({ name: 1 }).lean<ServiceDoc[]>(),
  async createService(service, session) {
    const [created] = await ServiceModel.create([service], { session });
    return created!.toObject();
  },
  async updateService(id, expectedVersion, changes, session) {
    const { $set, $unset } = toUpdate(changes);
    const updated = await ServiceModel.findOneAndUpdate(
      { _id: id, __v: expectedVersion },
      { $set, $unset, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true, session },
    ).lean<ServiceDoc>();
    if (!updated) {
      throw new ConflictError(
        'The service was changed by someone else. Reload and try again.',
        'STALE_VERSION',
      );
    }
    return updated;
  },
  async serviceSlugsLike(base) {
    return (await ServiceModel.find(slugFilter(base), { slug: 1 }).lean()).map((s) => s.slug);
  },
  async setServiceRating(id, ratingAvg, ratingCount) {
    await ServiceModel.updateOne({ _id: id }, { $set: { ratingAvg, ratingCount } });
  },
};
