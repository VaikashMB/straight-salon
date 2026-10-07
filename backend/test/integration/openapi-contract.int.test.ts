import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '../../src/docs/openapi.js';
import '../../src/modules/index.js'; // registers every module's paths

// 04 §2: every endpoint declares summary, tags, security (or [] for public), its request
// schemas and all its response codes with schemas. Checked across the whole document.
const doc = generateOpenApiDocument('test');
const operations = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
  (['get', 'post', 'put', 'patch', 'delete'] as const)
    .filter((method) => item?.[method])
    .map((method) => ({ path, method, op: item[method]! })),
);

describe('OpenAPI contract (04 §2)', () => {
  it('documents every Phase 4 endpoint (API-016..037)', () => {
    const ids = operations
      .map(({ op }) => /\(API-(\d{3})\)/.exec(op.summary ?? '')?.[1])
      .filter(Boolean);
    for (let n = 16; n <= 37; n++) {
      if (n >= 28 && n <= 29) continue; // unassigned in 04 §3
      expect(ids, `API-0${n}`).toContain(String(n).padStart(3, '0'));
    }
  });

  it('documents every Phase 7 endpoint (API-060..062, API-070..073)', () => {
    const ids = operations.map(({ op }) => /\(API-(\d{3})\)/.exec(op.summary ?? '')?.[1]);
    for (const n of [60, 61, 62, 70, 71, 72, 73]) expect(ids, `API-0${n}`).toContain(`0${n}`);
  });

  it('API-072 is documented as text/csv; the booking DTO carries canReview', () => {
    const csv = doc.paths?.['/api/v1/reports/summary.csv']?.get?.responses?.['200'] as {
      content?: Record<string, unknown>;
    };
    expect(Object.keys(csv.content ?? {})).toEqual(['text/csv']);
    const booking = doc.components?.schemas?.Booking as { required?: string[] };
    expect(booking.required).toContain('canReview');
  });

  it.each(operations.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))(
    '%s has summary, tags, security and documented responses',
    (_name, { op, path }) => {
      expect(op.summary).toBeTruthy();
      expect(op.tags?.length).toBeGreaterThan(0);
      expect(op.security).toBeDefined();
      const codes = Object.keys(op.responses ?? {});
      expect(codes.some((code) => code.startsWith('2'))).toBe(true);
      // Anything behind a bearer token documents 401.
      const needsAuth =
        (op.security ?? []).length > 0 &&
        !(op.security ?? []).some((s) => Object.keys(s).length === 0);
      if (needsAuth && !path.startsWith('/api/v1/auth')) expect(codes).toContain('401');
      if (path.includes('{')) expect(op.parameters?.length).toBeGreaterThan(0);
    },
  );

  it('registers the Phase 4 and Phase 7 components', () => {
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'PublicSettings',
        'Settings',
        'Holiday',
        'Category',
        'Service',
        'ServiceDetail',
        'UploadedImage',
        'Staff',
        'StaffProfile',
        'StaffSchedule',
        'TimeOff',
        'Review',
        'ReviewList',
        'Dashboard',
        'ReportSummary',
        'AuditLog',
        'AuditLogList',
      ]),
    );
  });
});
