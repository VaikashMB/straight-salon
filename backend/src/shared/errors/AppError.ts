// Error hierarchy from 03-backend §4. `code` is the stable, machine-readable identifier the
// frontend maps to text (04 §4); `message` becomes the problem `detail`.

export interface FieldError {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly errors?: FieldError[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is invalid.', errors?: FieldError[]) {
    super(400, 'VALIDATION_FAILED', message, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.', code = 'UNAUTHENTICATED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The resource was not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'DUPLICATE') {
    super(409, code, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'The request body is too large.') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, errors?: FieldError[]) {
    super(422, code, message, errors);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(429, 'RATE_LIMITED', message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'The service is temporarily unavailable. Please try again.') {
    super(503, 'TEMPORARILY_UNAVAILABLE', message);
  }
}
