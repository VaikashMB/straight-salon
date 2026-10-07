import type { Request, Response } from 'express';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type { CreateReviewBody, ListReviewsQuery, UpdateReviewBody } from './reviews.schemas.js';
import type { ReviewsService } from './reviews.service.js';

// HTTP <-> service mapping only (03 §2).
export function createReviewsController(reviews: ReviewsService) {
  const id = (req: Request) => validatedPart<{ id: string }>(req, 'params').id;

  return {
    create: async (req: Request, res: Response) => {
      res
        .status(201)
        .json(
          await reviews.create(
            id(req),
            validatedPart<CreateReviewBody>(req, 'body'),
            requireAuth(req),
          ),
        );
    },
    list: async (req: Request, res: Response) => {
      res.json(await reviews.list(validatedPart<ListReviewsQuery>(req, 'query'), req.auth));
    },
    setVisibility: async (req: Request, res: Response) => {
      res.json(
        await reviews.setVisibility(
          id(req),
          validatedPart<UpdateReviewBody>(req, 'body'),
          requireAuth(req),
        ),
      );
    },
  };
}

export type ReviewsController = ReturnType<typeof createReviewsController>;
