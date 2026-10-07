import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_MESSAGES, errorMessage, fieldErrors, toProblem } from '@/lib/errors';

const response = (status: number, requestId?: string) =>
  new Response(null, { status, headers: requestId ? { 'x-request-id': requestId } : {} });

describe('problems (03 §4, RFC 7807)', () => {
  it('reads code, detail, request id and field errors from the body', () => {
    const problem = toProblem(
      {
        code: 'VALIDATION_FAILED',
        title: 'Bad Request',
        detail: 'The request is invalid.',
        requestId: 'body-id',
        errors: [{ path: 'email', message: 'Invalid' }, { nope: true }],
      },
      response(400, 'header-id'),
    );
    expect(problem).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Bad Request',
      detail: 'The request is invalid.',
      requestId: 'body-id',
      errors: [{ path: 'email', message: 'Invalid' }],
    });
  });

  it('falls back to the status and the X-Request-Id header for non-problem bodies', () => {
    expect(toProblem('Bad gateway', response(502, 'r-1'))).toEqual({
      status: 502,
      code: 'INTERNAL_ERROR',
      requestId: 'r-1',
    });
    expect(toProblem(undefined, response(404))).toEqual({ status: 404, code: 'HTTP_404' });
    expect(toProblem({ code: 'NOT_FOUND' }, response(404, 'r-2')).requestId).toBe('r-2');
  });
});

describe('user-facing messages (05 §6)', () => {
  it('maps codes, never server messages', () => {
    const error = new ApiError({ status: 409, code: 'SLOT_UNAVAILABLE', detail: 'server text' });
    expect(errorMessage(error)).toBe(ERROR_MESSAGES.SLOT_UNAVAILABLE);
    expect(error.message).toBe('server text');
    expect(error.status).toBe(409);
  });

  it('unknown codes show the request id for support', () => {
    expect(errorMessage(new ApiError({ status: 500, code: 'X', requestId: 'abc' }))).toBe(
      'Something went wrong (ref: abc)',
    );
    expect(errorMessage(new ApiError({ status: 500, code: 'X' }))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });

  it('covers every 04 §4 code', () => {
    for (const code of [
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'TOKEN_EXPIRED',
      'FORBIDDEN',
      'NOT_FOUND',
      'DUPLICATE',
      'STALE_VERSION',
      'SLOT_UNAVAILABLE',
      'OUTSIDE_BUSINESS_HOURS',
      'LEAD_TIME_VIOLATION',
      'ADVANCE_WINDOW_VIOLATION',
      'CUTOFF_PASSED',
      'STAFF_CANNOT_PERFORM_SERVICE',
      'BOOKING_LIMIT_REACHED',
      'INVALID_STATUS_TRANSITION',
      'PAYMENT_MISMATCH',
      'REVIEW_NOT_ALLOWED',
      'RATE_LIMITED',
      'IDEMPOTENCY_KEY_REUSED',
      'PAYMENT_ALREADY_RECORDED',
      'PAYMENT_NOT_ALLOWED',
      'INVALID_RESET_TOKEN',
      'PHONE_ALREADY_REGISTERED',
      'ACTIVE_BOOKINGS_EXIST',
      'INVALID_FILE',
      'INVALID_DURATION',
      'PAYLOAD_TOO_LARGE',
      'TEMPORARILY_UNAVAILABLE',
    ]) {
      expect(ERROR_MESSAGES[code], code).toBeTruthy();
    }
  });

  it('field errors keep the first message per field', () => {
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [
        { path: 'email', message: 'first' },
        { path: 'email', message: 'second' },
        { path: 'phone', message: 'bad' },
      ],
    });
    expect(fieldErrors(error)).toEqual({ email: 'first', phone: 'bad' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});
