import type { FieldError } from './AppError.js';

// RFC 7807 problem details (03-backend §4).
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  requestId?: string;
  errors?: FieldError[];
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const PROBLEM_TYPE_BASE = 'https://straightsalon.dev/errors/';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  422: 'Business rule violated',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

// SLOT_UNAVAILABLE -> https://straightsalon.dev/errors/slot-unavailable
export function problemType(code: string): string {
  return PROBLEM_TYPE_BASE + code.toLowerCase().replace(/_/g, '-');
}

export function buildProblem(input: {
  status: number;
  code: string;
  detail: string;
  instance: string;
  requestId?: string | undefined;
  errors?: FieldError[] | undefined;
}): Problem {
  const problem: Problem = {
    type: problemType(input.code),
    title: TITLES[input.status] ?? 'Error',
    status: input.status,
    code: input.code,
    detail: input.detail,
    instance: input.instance,
  };
  if (input.requestId) problem.requestId = input.requestId;
  if (input.errors?.length) problem.errors = input.errors;
  return problem;
}
