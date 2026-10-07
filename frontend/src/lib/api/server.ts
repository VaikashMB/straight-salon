import createClient from 'openapi-fetch';
import { unwrap, type ApiClient } from './client';
import type { paths } from './schema';

// Server-side reads for the public catalogue pages (05 §6). Server Components call the backend
// directly at API_INTERNAL_URL (read per request, never at build, 11 §5), and Next's data cache
// keeps each response for 5 minutes, so pages stay fast and SEO-friendly while catalogue edits
// show up within that window.

export const PUBLIC_REVALIDATE_SECONDS = 300;

export function serverApi(): ApiClient {
  const baseUrl = process.env.API_INTERNAL_URL;
  if (!baseUrl) throw new Error('API_INTERNAL_URL is not set');
  return createClient<paths>({
    baseUrl,
    fetch: (request: Request) =>
      fetch(request, { next: { revalidate: PUBLIC_REVALIDATE_SECONDS } }),
  });
}

// A public read, or null when the API cannot answer (the page shows a fallback instead of
// failing). `notFound` lets detail pages tell a missing item from an outage.
export async function loadPublic<T>(
  read: (api: ApiClient) => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<{ data: T } | { data: null; notFound: boolean }> {
  try {
    return { data: await unwrap(read(serverApi())) };
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { data: null, notFound: status === 404 };
  }
}
