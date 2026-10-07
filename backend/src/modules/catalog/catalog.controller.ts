import type { Request, Response } from 'express';
import { uploadedFile } from '../../shared/http/upload.js';
import { validatedPart } from '../../shared/http/validate.js';
import type {
  CreateCategoryBody,
  CreateServiceBody,
  ListCategoriesQuery,
  ListServicesQuery,
  UpdateCategoryBody,
  UpdateServiceBody,
} from './catalog.schemas.js';
import type { CatalogService } from './catalog.service.js';

// HTTP <-> service mapping only (03 §2).
export function createCatalogController(catalog: CatalogService) {
  const id = (req: Request) => validatedPart<{ id: string }>(req, 'params').id;

  return {
    listCategories: async (req: Request, res: Response) => {
      res.json(
        await catalog.listCategories(validatedPart<ListCategoriesQuery>(req, 'query'), req.auth),
      );
    },
    createCategory: async (req: Request, res: Response) => {
      res
        .status(201)
        .json(await catalog.createCategory(validatedPart<CreateCategoryBody>(req, 'body')));
    },
    updateCategory: async (req: Request, res: Response) => {
      res.json(
        await catalog.updateCategory(id(req), validatedPart<UpdateCategoryBody>(req, 'body')),
      );
    },
    deactivateCategory: async (req: Request, res: Response) => {
      await catalog.deactivateCategory(id(req));
      res.status(204).end();
    },
    listServices: async (req: Request, res: Response) => {
      res.json(
        await catalog.listServices(validatedPart<ListServicesQuery>(req, 'query'), req.auth),
      );
    },
    getService: async (req: Request, res: Response) => {
      const { idOrSlug } = validatedPart<{ idOrSlug: string }>(req, 'params');
      res.json(await catalog.getService(idOrSlug, req.auth));
    },
    createService: async (req: Request, res: Response) => {
      res
        .status(201)
        .json(await catalog.createService(validatedPart<CreateServiceBody>(req, 'body')));
    },
    updateService: async (req: Request, res: Response) => {
      res.json(await catalog.updateService(id(req), validatedPart<UpdateServiceBody>(req, 'body')));
    },
    deactivateService: async (req: Request, res: Response) => {
      await catalog.deactivateService(id(req));
      res.status(204).end();
    },
    uploadImage: async (req: Request, res: Response) => {
      res.status(201).json(await catalog.uploadImage(uploadedFile(req, 'file').buffer));
    },
  };
}

export type CatalogController = ReturnType<typeof createCatalogController>;
