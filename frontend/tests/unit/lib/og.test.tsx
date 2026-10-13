// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadOgFonts, loadOgPhoto, publicFile } from '@/lib/og/assets';
import { OG_SIZE, renderOgImage, titleSize } from '@/lib/og/card';
import { PAGE_OG, ratingLine, serviceOg, stylistOg } from '@/lib/og/pages';
import { server } from '../helpers/api';
import { makeService, makeStylist } from '../helpers/fixtures';

// Share images (05 §2): the salon card rendered by next/og with a photo panel.

const loadPublic = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server', () => ({ loadPublic }));

const PNG = [0x89, 0x50, 0x4e, 0x47];
const isPng = async (response: Response) =>
  [...new Uint8Array(await response.arrayBuffer()).slice(0, 4)].every((b, i) => b === PNG[i]);

// next/og fetches its WebAssembly renderer from a data: URL; nothing here talks to the API.
beforeAll(() => server.close());

afterEach(() => {
  loadPublic.mockReset();
  vi.unstubAllGlobals();
});

describe('share image content (05 §2)', () => {
  it('every page card points at photos that exist in public/', () => {
    for (const card of Object.values(PAGE_OG)) {
      for (const photo of card.photos) expect(existsSync(publicFile(photo)!)).toBe(true);
    }
  });

  it('steps the title down as names get longer', () => {
    expect(titleSize('Haircut')).toBe(80);
    expect(titleSize('Keratin Smoothing Deluxe')).toBe(68);
    expect(titleSize('A very long service name that keeps going')).toBe(58);
  });

  it('says how a service or stylist is rated, or nothing before the first review', () => {
    expect(ratingLine(4.75, 32)).toBe('Rated 4.8 by 32 guests');
    expect(ratingLine(5, 1)).toBe('Rated 5.0 by 1 guest');
    expect(ratingLine(0, 0)).toBeNull();
  });

  it('a service card: category, name, time and rating, its photo first', () => {
    const service = makeService({ ratingAvg: 4.5, ratingCount: 3, imageUrl: '/demo/x.webp' });
    expect(serviceOg(service, 'Hair')).toEqual({
      eyebrow: 'Hair',
      title: 'Haircut',
      subtitle: '45 min · Rated 4.5 by 3 guests',
      photos: ['/demo/x.webp', '/salon/a.webp'],
    });
    expect(serviceOg(makeService({ ratingCount: 0 })).eyebrow).toBe('Service');
    expect(serviceOg(null).title).toBe(PAGE_OG.services.title);
  });

  it('a stylist card: name, a booking line and the rating (or the bio)', () => {
    const stylist = makeStylist({ displayName: 'Priya Nair', ratingAvg: 4.9, ratingCount: 12 });
    expect(stylistOg(stylist)).toMatchObject({
      eyebrow: 'Stylist',
      title: 'Priya Nair',
      em: 'Book with Priya.',
      subtitle: 'Rated 4.9 by 12 guests',
    });
    expect(stylistOg(makeStylist({ ratingCount: 0, bio: 'Fades.' })).subtitle).toBe('Fades.');
    expect(stylistOg(null).title).toBe(PAGE_OG.stylists.title);
  });
});

describe('share image assets', () => {
  it('only reads files inside public/', () => {
    expect(publicFile('/salon/a.webp')).toBe(path.join(process.cwd(), 'public', 'salon', 'a.webp'));
    expect(publicFile('/../package.json')).toBeNull();
    expect(publicFile('/%2e%2e/package.json')).toBeNull();
  });

  it('loads the four TTF faces once', async () => {
    const fonts = await loadOgFonts();
    expect(fonts.map((f) => `${f.name} ${f.weight} ${f.style}`)).toEqual([
      'Fraunces 600 normal',
      'Fraunces 500 italic',
      'Outfit 400 normal',
      'Outfit 500 normal',
    ]);
    expect(await loadOgFonts()).toBe(fonts);
  });

  it('converts the first readable photo to a JPEG, skipping broken ones', async () => {
    const photo = await loadOgPhoto(undefined, '/missing.webp', '/salon/a.webp');
    expect(photo).toMatch(/^data:image\/jpeg;base64,/);
    expect(await loadOgPhoto('/missing.webp', '/../secret')).toBeNull();
  });

  it('fetches uploaded photos by URL and falls back when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadOgPhoto('https://cdn.example/a.jpg')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/a.jpg', expect.anything());
  });
});

describe('share image routes', () => {
  it('renders a 1200×630 PNG, with or without a photo', async () => {
    const response = await renderOgImage({ ...PAGE_OG.home, photos: [] });
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await isPng(response)).toBe(true);
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  }, 20_000);

  it('page routes export their size, type and alt', async () => {
    const pages = await Promise.all([
      import('@/app/opengraph-image'),
      import('@/app/(public)/services/opengraph-image'),
      import('@/app/(public)/stylists/opengraph-image'),
      import('@/app/(public)/gallery/opengraph-image'),
      import('@/app/(public)/location/opengraph-image'),
      import('@/app/(public)/book/opengraph-image'),
    ]);
    for (const page of pages) {
      expect(page.size).toEqual(OG_SIZE);
      expect(page.contentType).toBe('image/png');
      expect(page.alt).toMatch(/Straight Salon/);
    }
    expect(await isPng(await pages[3].default())).toBe(true);
  }, 30_000);

  it('a service route reads the service and its category from the API', async () => {
    const { default: Image } = await import('@/app/(public)/services/[slug]/opengraph-image');
    loadPublic
      .mockResolvedValueOnce({ data: makeService({ imageUrl: '/demo/services/haircut.webp' }) })
      .mockResolvedValueOnce({ data: [{ id: makeService().categoryId, name: 'Hair' }] });
    const response = await Image({ params: Promise.resolve({ slug: 'haircut' }) });
    expect(await isPng(response)).toBe(true);
    expect(loadPublic).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('a stylist route falls back to the team card when the API cannot answer', async () => {
    const { default: Image } = await import('@/app/(public)/stylists/[id]/opengraph-image');
    loadPublic.mockResolvedValueOnce({ data: null, notFound: false });
    expect(await isPng(await Image({ params: Promise.resolve({ id: 'x' }) }))).toBe(true);
  }, 20_000);
});
