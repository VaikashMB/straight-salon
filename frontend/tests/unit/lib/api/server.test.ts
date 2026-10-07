import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPublic, serverApi } from '@/lib/api/server';
import { problem, server, settings } from '../../helpers/api';
import { backend, useBackend } from '../../helpers/backend';

describe('server-side public reads (05 §6)', () => {
  afterEach(() => {
    delete process.env.API_INTERNAL_URL;
  });

  it('reads from API_INTERNAL_URL', async () => {
    useBackend();
    await expect(loadPublic((api) => api.GET('/api/v1/settings/public'))).resolves.toEqual({
      data: settings,
    });
  });

  it('tells a missing item from an outage', async () => {
    useBackend();
    server.use(
      http.get(backend('/staff/:id'), () => problem(404, 'NOT_FOUND')),
      http.get(backend('/categories'), () => HttpResponse.error()),
    );
    await expect(
      loadPublic((api) => api.GET('/api/v1/staff/{id}', { params: { path: { id: 'x' } } })),
    ).resolves.toEqual({ data: null, notFound: true });
    await expect(loadPublic((api) => api.GET('/api/v1/categories'))).resolves.toEqual({
      data: null,
      notFound: false,
    });
  });

  it('needs API_INTERNAL_URL (never baked in at build time, 11 §5)', async () => {
    expect(() => serverApi()).toThrow('API_INTERNAL_URL');
    await expect(loadPublic((api) => api.GET('/api/v1/categories'))).resolves.toMatchObject({
      data: null,
    });
  });
});
