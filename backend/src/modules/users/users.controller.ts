import type { Request, Response } from 'express';
import { requireAuth } from '../../shared/auth/middleware.js';
import { validatedPart } from '../../shared/http/validate.js';
import type {
  AdminUpdateBody,
  CreateUserBody,
  ListUsersQuery,
  UpdateMeBody,
  WalkInBody,
} from './users.schemas.js';
import type { UsersService } from './users.service.js';

// HTTP <-> service mapping only (03 §2).
export function createUsersController(users: UsersService) {
  const id = (req: Request) => validatedPart<{ id: string }>(req, 'params').id;

  return {
    updateMe: async (req: Request, res: Response) => {
      res.json(
        await users.updateMe(requireAuth(req).userId, validatedPart<UpdateMeBody>(req, 'body')),
      );
    },
    list: async (req: Request, res: Response) => {
      res.json(await users.list(validatedPart<ListUsersQuery>(req, 'query'), requireAuth(req)));
    },
    create: async (req: Request, res: Response) => {
      res.status(201).json(await users.createAccount(validatedPart<CreateUserBody>(req, 'body')));
    },
    walkIn: async (req: Request, res: Response) => {
      const { user, created } = await users.findOrCreateWalkIn(
        validatedPart<WalkInBody>(req, 'body'),
      );
      res.status(created ? 201 : 200).json(user);
    },
    get: async (req: Request, res: Response) => {
      res.json(await users.getForStaff(id(req), requireAuth(req)));
    },
    adminUpdate: async (req: Request, res: Response) => {
      res.json(
        await users.adminUpdate(
          id(req),
          validatedPart<AdminUpdateBody>(req, 'body'),
          requireAuth(req),
        ),
      );
    },
  };
}

export type UsersController = ReturnType<typeof createUsersController>;
