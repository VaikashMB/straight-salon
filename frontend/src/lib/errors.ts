// API errors (RFC 7807 problems, 03 §4) and their user-facing text. The UI maps the stable
// `code`, never the server's message (04 §4); unknown codes show the request id for support.

export interface FieldProblem {
  path: string;
  message: string;
}

export interface Problem {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  requestId?: string;
  errors?: FieldProblem[];
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title ?? problem.code);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }
}

export const NETWORK_ERROR = 'NETWORK_ERROR';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// An openapi-fetch `error` (parsed body) plus its response, as a Problem.
export function toProblem(body: unknown, response: Response): Problem {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (isRecord(body) && typeof body.code === 'string') {
    const problem: Problem = { status: response.status, code: body.code };
    if (typeof body.title === 'string') problem.title = body.title;
    if (typeof body.detail === 'string') problem.detail = body.detail;
    const id = typeof body.requestId === 'string' ? body.requestId : requestId;
    if (id) problem.requestId = id;
    if (Array.isArray(body.errors)) {
      problem.errors = body.errors.filter(
        (e): e is FieldProblem =>
          isRecord(e) && typeof e.path === 'string' && typeof e.message === 'string',
      );
    }
    return problem;
  }
  return {
    status: response.status,
    code: response.status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${response.status}`,
    ...(requestId ? { requestId } : {}),
  };
}

// 04 §4 codes -> text. Context-specific wording (e.g. failed login) lives with the form.
export const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: 'Please check the highlighted fields.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  DUPLICATE: 'That already exists.',
  STALE_VERSION: 'Someone else changed this just now. Reload and try again.',
  SLOT_UNAVAILABLE: 'That time is no longer available. Please pick another slot.',
  OUTSIDE_BUSINESS_HOURS: 'The stylist is not working at that time.',
  LEAD_TIME_VIOLATION: 'That time is too soon to book online. Please pick a later slot.',
  ADVANCE_WINDOW_VIOLATION: 'That date is too far ahead. Please pick an earlier date.',
  CUTOFF_PASSED: "It's too close to the appointment to change it online. Please call the salon.",
  STAFF_CANNOT_PERFORM_SERVICE: "This stylist doesn't offer all the selected services.",
  BOOKING_LIMIT_REACHED: 'You already have the maximum number of upcoming bookings.',
  INVALID_STATUS_TRANSITION: "This booking can't be moved to that status.",
  PAYMENT_MISMATCH: 'The amount paid and the discount must add up to the total.',
  PAYMENT_ALREADY_RECORDED: 'A payment has already been recorded for this booking.',
  PAYMENT_NOT_ALLOWED: 'Payment can only be recorded once the appointment is completed.',
  REVIEW_NOT_ALLOWED: 'This appointment can no longer be reviewed.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This request is already being processed. Please wait a moment.',
  INVALID_RESET_TOKEN: 'This reset link is invalid or has expired. Please request a new one.',
  PHONE_ALREADY_REGISTERED:
    'This phone number is already registered at the salon. Please contact the front desk.',
  ACTIVE_BOOKINGS_EXIST: 'There are active bookings in the way.',
  INVALID_FILE: 'Please upload a PNG, JPEG or WebP image up to 2 MB.',
  INVALID_DURATION: 'The duration must fit the booking grid.',
  PAYLOAD_TOO_LARGE: 'That is too much data to send at once.',
  TEMPORARILY_UNAVAILABLE: 'The service is busy right now. Please try again in a moment.',
  [NETWORK_ERROR]: "Can't reach the server. Check your connection and try again.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const known = ERROR_MESSAGES[error.code];
    if (known) return known;
    const ref = error.problem.requestId;
    return ref ? `Something went wrong (ref: ${ref})` : 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

// Server field errors (body paths like "email") keyed by field, first message wins.
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const result: Record<string, string> = {};
  for (const e of error.problem.errors ?? []) result[e.path] ??= e.message;
  return result;
}
