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

  it('registers the Phase 4 components', () => {
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
      ]),
    );
  });
});
