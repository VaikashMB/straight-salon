import mongoose, { Schema, type Types } from 'mongoose';

// service_categories and services (02-database §2.4, §2.5)

export interface CategoryDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceDoc {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  categoryId: Types.ObjectId;
  description?: string;
  durationMin: number; // multiple of settings.slotGranularityMin (BR-013)
  priceMinor: number; // smallest currency unit
  imageUrl?: string;
  isActive: boolean;
  ratingAvg: number; // denormalised by the ratings consumer (FR-061)
  ratingCount: number;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true },
    description: { type: String, maxlength: 500 },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { collection: 'service_categories', timestamps: true },
);

categorySchema.index({ name: 1 }, { unique: true });
categorySchema.index({ slug: 1 }, { unique: true });

const serviceSchema = new Schema<ServiceDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    description: { type: String, maxlength: 1000 },
    durationMin: { type: Number, required: true, min: 1 },
    priceMinor: { type: Number, required: true, min: 0 },
    imageUrl: String,
    isActive: { type: Boolean, required: true, default: true },
    ratingAvg: { type: Number, required: true, default: 0 },
    ratingCount: { type: Number, required: true, default: 0 },
  },
  { collection: 'services', timestamps: true, optimisticConcurrency: true },
);

serviceSchema.index({ slug: 1 }, { unique: true });
serviceSchema.index({ categoryId: 1, isActive: 1 });
serviceSchema.index({ name: 'text', description: 'text' });
// "unique among active" (02 §2.5): a deactivated service frees its name.
serviceSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export const CategoryModel =
  (mongoose.models.Category as mongoose.Model<CategoryDoc> | undefined) ??
  mongoose.model<CategoryDoc>('Category', categorySchema);

export const ServiceModel =
  (mongoose.models.Service as mongoose.Model<ServiceDoc> | undefined) ??
  mongoose.model<ServiceDoc>('Service', serviceSchema);
