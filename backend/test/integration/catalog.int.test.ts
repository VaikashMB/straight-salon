import type { Express } from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CategoryModel, ServiceModel } from '../../src/modules/catalog/catalog.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { loginAs } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { createCategory, createService, createStylist, newId } from '../helpers/fixtures.js';
import type { MemoryStorage } from '../helpers/storage.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;
let redis: ReturnType<typeof buildApiTestApp>['redis'];
let storage: MemoryStorage;
let admin: string;

beforeAll(async () => {
  await connectTestDb();
  await ServiceModel.syncIndexes(); // text + partial unique indexes
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  const built = buildApiTestApp();
  app = built.app;
  redis = built.redis;
  storage = built.storage as MemoryStorage;
  admin = (await loginAs('ADMIN')).header;
});

const api = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  header?: string,
) => {
  const req = request(app)[method](`/api/v1${path}`);
  return header ? req.set('Authorization', header) : req;
};

describe('categories (API-021, API-022)', () => {
  it('admin creates, renames and deactivates; each change audited with EVT-031', async () => {
    const created = await api('post', '/categories', admin).send({
      name: 'Beard & Grooming',
      description: 'Trims and shaves',
      sortOrder: 2,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'beard-grooming', isActive: true, sortOrder: 2 });
    const id = (created.body as { id: string }).id;

    const renamed = await api('patch', `/categories/${id}`, admin).send({
      name: 'Grooming',
      description: null,
    });
    expect(renamed.body).toMatchObject({ name: 'Grooming', slug: 'beard-grooming' });
    expect(renamed.body).not.toHaveProperty('description');

    expect((await api('delete', `/categories/${id}`, admin)).status).toBe(204);
    expect((await api('delete', `/categories/${id}`, admin)).status).toBe(204); // idempotent

    const actions = (await AuditLogModel.find({ entityId: id }).sort({ at: 1 }).lean()).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['category.create', 'category.update', 'category.deactivate']);
    expect(await OutboxModel.countDocuments({ type: 'catalog.changed', aggregateId: id })).toBe(3);
  });

  it('public list: active only, sorted by sortOrder then name, cached until a change', async () => {
    await createCategory({ name: 'Skin', sortOrder: 3 });
    await createCategory({ name: 'Hair', sortOrder: 1 });
    const nails = await createCategory({ name: 'Nails', sortOrder: 1 });
    await CategoryModel.updateOne({ name: 'Skin' }, { isActive: false });

    const list = await api('get', '/categories');
    expect((list.body as { name: string }[]).map((c) => c.name)).toEqual(['Hair', 'Nails']);
    expect(await redis.get('ss:v1:catalog:categories')).not.toBeNull();

    await api('patch', `/categories/${nails._id.toHexString()}`, admin).send({ sortOrder: 0 });
    const after = await api('get', '/categories');
    expect((after.body as { name: string }[]).map((c) => c.name)).toEqual(['Nails', 'Hair']);
  });

  it('includeInactive=true is ADMIN only (401 anonymous, 403 receptionist)', async () => {
    await createCategory({ name: 'Hair' });
    await CategoryModel.create({ name: 'Old', slug: 'old', sortOrder: 9, isActive: false });
    const all = await api('get', '/categories?includeInactive=true', admin);
    expect(all.body).toHaveLength(2);
    expect((await api('get', '/categories?includeInactive=true')).status).toBe(401);
    expect(
      (await api('get', '/categories?includeInactive=true', (await loginAs('RECEPTIONIST')).header))
        .status,
    ).toBe(403);
    // A stale/invalid token on a public endpoint is a 401, not silently anonymous.
    expect((await api('get', '/categories', 'Bearer not-a-token')).status).toBe(401);
  });

  it('permission catalog:manage and validation: 403, 401, 409, 404, 400', async () => {
    const receptionist = (await loginAs('RECEPTIONIST')).header;
    expect((await api('post', '/categories', receptionist).send({ name: 'Hair' })).status).toBe(
      403,
    );
    expect((await api('post', '/categories').send({ name: 'Hair' })).status).toBe(401);
    expect((await api('post', '/categories', admin).send({ name: 'Hair' })).status).toBe(201);
    expect((await api('post', '/categories', admin).send({ name: 'Hair' })).status).toBe(409);
    const other = await createCategory({ name: 'Skin' });
    expect(
      (await api('patch', `/categories/${other._id.toHexString()}`, admin).send({ name: 'Hair' }))
        .status,
    ).toBe(409);
    expect((await api('patch', `/categories/${newId()}`, admin).send({ name: 'X Y' })).status).toBe(
      404,
    );
    expect((await api('patch', `/categories/${newId()}`, admin).send({})).status).toBe(400);
    expect((await api('post', '/categories', admin).send({ name: 'H' })).status).toBe(400);
  });
});

describe('services (API-023..026)', () => {
  it('admin creates a service: slug, Money price, audit, EVT-031', async () => {
    const category = await createCategory({ name: 'Hair' });
    const res = await api('post', '/services', admin).send({
      name: 'Hair Colour (Global)',
      categoryId: category._id.toHexString(),
      durationMin: 120,
      priceMinor: 250_000,
      description: 'Full head colour',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      slug: 'hair-colour-global',
      price: { amountMinor: 250_000, currency: 'INR' },
      isActive: true,
      ratingAvg: 0,
      ratingCount: 0,
    });
    const id = (res.body as { id: string }).id;
    expect(
      await AuditLogModel.findOne({ action: 'service.create', entityId: id }).lean(),
    ).toMatchObject({
      after: { priceMinor: 250_000, durationMin: 120 },
    });
    expect(await OutboxModel.findOne({ type: 'catalog.changed' }).lean()).toMatchObject({
      payload: { entityType: 'service', entityId: id },
    });
  });

  it('BR-013: duration must be a multiple of the slot granularity (422 INVALID_DURATION)', async () => {
    const category = await createCategory();
    const body = { name: 'Odd', categoryId: category._id.toHexString(), priceMinor: 100 };
    const bad = await api('post', '/services', admin).send({ ...body, durationMin: 40 });
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ code: 'INVALID_DURATION' });
    const ok = await api('post', '/services', admin).send({ ...body, durationMin: 45 });
    expect(ok.status).toBe(201);
    const id = (ok.body as { id: string }).id;
    expect((await api('patch', `/services/${id}`, admin).send({ durationMin: 50 })).status).toBe(
      422,
    );
  });

  it('names are unique among active services; a deactivated name is free; slugs never clash', async () => {
    const category = await createCategory();
    const body = {
      name: 'Haircut',
      categoryId: category._id.toHexString(),
      durationMin: 45,
      priceMinor: 40_000,
    };
    const first = await api('post', '/services', admin).send(body);
    expect((await api('post', '/services', admin).send(body)).status).toBe(409);
    const firstId = (first.body as { id: string }).id;
    expect((await api('delete', `/services/${firstId}`, admin)).status).toBe(204);
    const second = await api('post', '/services', admin).send(body);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ slug: 'haircut-2' });
    // Reactivating the first one would clash with the active name.
    const reactivate = await api('patch', `/services/${firstId}`, admin).send({ isActive: true });
    expect(reactivate.status).toBe(409);
  });

  it('PATCH changes fields, clears optional ones, validates the category; DELETE deactivates', async () => {
    const service = await createService({ name: 'Cleanup', description: 'Basic' });
    const id = service._id.toHexString();
    const otherCategory = await createCategory({ name: 'Skin' });
    const res = await api('patch', `/services/${id}`, admin).send({
      priceMinor: 85_000,
      description: null,
      categoryId: otherCategory._id.toHexString(),
      imageUrl: 'http://localhost:4000/uploads/images/a.webp',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      price: { amountMinor: 85_000 },
      categoryId: otherCategory._id.toHexString(),
      imageUrl: 'http://localhost:4000/uploads/images/a.webp',
    });
    expect(res.body).not.toHaveProperty('description');
    expect(
      (await api('patch', `/services/${id}`, admin).send({ categoryId: newId() })).status,
    ).toBe(400);

    expect((await api('delete', `/services/${id}`, admin)).status).toBe(204);
    expect(await AuditLogModel.findOne({ action: 'service.deactivate' }).lean()).toMatchObject({
      before: { isActive: true },
      after: { isActive: false },
    });
    expect((await api('delete', `/services/${newId()}`, admin)).status).toBe(404);
  });

  it('public list: active only, category filter, word search, pagination, sorting', async () => {
    const hair = await createCategory({ name: 'Hair' });
    const skin = await createCategory({ name: 'Skin' });
    await createService({
      name: 'Haircut',
      categoryId: hair._id,
      priceMinor: 40_000,
      durationMin: 45,
    });
    await createService({
      name: 'Hair Spa',
      categoryId: hair._id,
      priceMinor: 120_000,
      durationMin: 60,
    });
    await createService({
      name: 'Classic Facial',
      categoryId: skin._id,
      description: 'Deep cleanse',
    });
    await createService({ name: 'Retired Cut', categoryId: hair._id, isActive: false });

    const all = await api('get', '/services');
    expect(all.status).toBe(200);
    expect((all.body as { data: { name: string }[] }).data.map((s) => s.name)).toEqual([
      'Classic Facial',
      'Hair Spa',
      'Haircut',
    ]);
    const byCategory = await api(
      'get',
      `/services?categoryId=${hair._id.toHexString()}&sort=-priceMinor`,
    );
    expect((byCategory.body as { data: { name: string }[] }).data.map((s) => s.name)).toEqual([
      'Hair Spa',
      'Haircut',
    ]);
    const search = await api('get', '/services?q=cleanse');
    expect((search.body as { data: { name: string }[] }).data.map((s) => s.name)).toEqual([
      'Classic Facial',
    ]);
    const page = await api('get', '/services?page=2&pageSize=2');
    expect(page.body).toMatchObject({ meta: { page: 2, pageSize: 2, total: 3, totalPages: 2 } });

    const admins = await api('get', '/services?includeInactive=true', admin);
    expect((admins.body as { meta: { total: number } }).meta.total).toBe(4);
    expect((await api('get', '/services?includeInactive=true')).status).toBe(401);
    expect((await api('get', '/services?pageSize=101')).status).toBe(400);
  });

  it('the cached list and detail are refreshed after a change (08 §4)', async () => {
    const service = await createService({ name: 'Haircut', priceMinor: 40_000 });
    const id = service._id.toHexString();
    expect((await api('get', '/services')).body).toMatchObject({
      data: [{ price: { amountMinor: 40_000 } }],
    });
    expect((await api('get', `/services/${service.slug}`)).status).toBe(200);
    expect((await redis.keys('ss:v1:catalog:*')).length).toBeGreaterThanOrEqual(2);

    await api('patch', `/services/${id}`, admin).send({ priceMinor: 45_000 });
    expect((await api('get', '/services')).body).toMatchObject({
      data: [{ price: { amountMinor: 45_000 } }],
    });
    expect((await api('get', `/services/${service.slug}`)).body).toMatchObject({
      price: { amountMinor: 45_000 },
    });
  });

  it('detail by id or slug includes active stylists who perform it; inactive is 404 except for admins', async () => {
    const service = await createService({ name: 'Beard Trim', slug: 'beard-trim' });
    await createStylist({ displayName: 'Ravi', serviceIds: [service._id] });
    await createStylist({ displayName: 'Gone', serviceIds: [service._id], isActive: false });
    await createStylist({ displayName: 'Other', serviceIds: [] });

    const bySlug = await api('get', '/services/BEARD-TRIM');
    expect(bySlug.status).toBe(200);
    expect(
      (bySlug.body as { stylists: { displayName: string }[] }).stylists.map((s) => s.displayName),
    ).toEqual(['Ravi']);
    const byId = await api('get', `/services/${service._id.toHexString()}`);
    expect(byId.body).toMatchObject({ slug: 'beard-trim' });

    await ServiceModel.updateOne({ _id: service._id }, { isActive: false });
    await redis.flushall();
    expect((await api('get', '/services/beard-trim')).status).toBe(404);
    expect((await api('get', '/services/beard-trim', admin)).body).toMatchObject({
      isActive: false,
    });
    expect((await api('get', '/services/no-such-service')).status).toBe(404);
    expect((await api('get', `/services/${newId()}`, admin)).status).toBe(404);
  });

  it('a stylist change refreshes the cached service detail', async () => {
    const service = await createService({ name: 'Manicure', slug: 'manicure' });
    expect((await api('get', '/services/manicure')).body).toMatchObject({ stylists: [] });
    const stylist = await createStylist({ displayName: 'Meera' });
    await api('patch', `/staff/${stylist.staffId}`, admin).send({
      serviceIds: [service._id.toHexString()],
    });
    expect((await api('get', '/services/manicure')).body).toMatchObject({
      stylists: [{ displayName: 'Meera' }],
    });
  });

  it('a settings currency change shows in cached prices', async () => {
    await createService({ name: 'Haircut' });
    await api('get', '/services');
    const settings = await api('get', '/settings', admin);
    await api('put', '/settings', admin).send({
      ...(settings.body as Record<string, unknown>),
      currency: 'USD',
      updatedAt: undefined,
    });
    expect((await api('get', '/services')).body).toMatchObject({
      data: [{ price: { currency: 'USD' } }],
    });
  });

  it('permission catalog:manage: receptionist 403 on create/update/delete', async () => {
    const receptionist = (await loginAs('RECEPTIONIST')).header;
    const service = await createService();
    const id = service._id.toHexString();
    expect((await api('post', '/services', receptionist).send({})).status).toBe(403);
    expect(
      (await api('patch', `/services/${id}`, receptionist).send({ priceMinor: 1 })).status,
    ).toBe(403);
    expect((await api('delete', `/services/${id}`, receptionist)).status).toBe(403);
  });
});

describe('POST /uploads/images (API-027)', () => {
  const png = () =>
    sharp({ create: { width: 4, height: 4, channels: 3, background: '#111111' } })
      .withMetadata({ exif: { IFD0: { Artist: 'Owner' } } })
      .png()
      .toBuffer();

  it('stores a re-encoded image under a random name and returns its URL', async () => {
    const res = await api('post', '/uploads/images', admin).attach('file', await png(), {
      filename: 'my photo.png',
      contentType: 'image/jpeg', // ignored: the type is sniffed from the bytes
    });
    expect(res.status).toBe(201);
    const { url } = res.body as { url: string };
    expect(url).toMatch(/^http:\/\/localhost:4000\/uploads\/images\/[0-9a-f-]{36}\.png$/);
    const [stored] = [...storage.objects.values()];
    expect(stored?.contentType).toBe('image/png');
    expect((await sharp(stored!.body).metadata()).exif).toBeUndefined();
  });

  it('400 INVALID_FILE for non-images and missing files; 413 above 2 MB', async () => {
    const text = await api('post', '/uploads/images', admin).attach(
      'file',
      Buffer.from('hello'),
      'a.png',
    );
    expect(text.status).toBe(400);
    expect(text.body).toMatchObject({ code: 'INVALID_FILE' });
    expect((await api('post', '/uploads/images', admin).send({ url: 'x' })).status).toBe(400);
    const big = await api('post', '/uploads/images', admin).attach(
      'file',
      Buffer.alloc(2 * 1024 * 1024 + 1),
      'big.png',
    );
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ code: 'INVALID_FILE' });
    expect(storage.objects.size).toBe(0);
  });

  it('permission uploads:create: admin only', async () => {
    const receptionist = (await loginAs('RECEPTIONIST')).header;
    expect(
      (await api('post', '/uploads/images', receptionist).attach('file', await png(), 'a.png'))
        .status,
    ).toBe(403);
    expect((await api('post', '/uploads/images').attach('file', await png(), 'a.png')).status).toBe(
      401,
    );
  });
});
