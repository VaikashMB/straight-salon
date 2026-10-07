import { http, HttpResponse } from 'msw';
import { settings, server } from './api';
import { categories, makeReview, page, services, stylists } from './fixtures';

// The backend as Server Components see it (API_INTERNAL_URL, 05 §6).
export const BACKEND = 'http://backend.test';
export const backend = (path: string) => `${BACKEND}/api/v1${path}`;

export function useBackend() {
  process.env.API_INTERNAL_URL = BACKEND;
  server.use(
    http.get(backend('/settings/public'), () => HttpResponse.json(settings)),
    http.get(backend('/categories'), () => HttpResponse.json(categories)),
    http.get(backend('/services'), () => HttpResponse.json(page(services))),
    http.get(backend('/staff'), () => HttpResponse.json(stylists)),
    http.get(backend('/reviews'), () => HttpResponse.json(page([makeReview()]))),
  );
}
