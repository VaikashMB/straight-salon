import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LocationPage from '@/app/(public)/location/page';
import { BRANDS, BrandMarquee } from '@/features/catalog/components/brand-marquee';
import { LOOKS, LooksCarousel, type Look } from '@/features/catalog/components/looks-carousel';
import { directionsUrl, mapEmbedUrl } from '@/features/catalog/location';
import { problem, server, settings } from '../../helpers/api';
import { backend, useBackend } from '../../helpers/backend';
import { ids, makeService } from '../../helpers/fixtures';

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
}));

const looks: Look[] = [
  { image: '/a.webp', serviceSlug: 'haircut', title: 'Precision Cut', tagline: 'Cut' },
  { image: '/b.webp', serviceSlug: 'gone', title: 'Old Look', tagline: 'Removed service' },
  { image: '/c.webp', serviceSlug: 'haircut', title: 'Third', tagline: 'Again' },
];
const services = [makeService()]; // slug "haircut", ₹400

// Hidden slides are inert, so select by the slide's label rather than its role.
const slide = (n: number) =>
  document.querySelector<HTMLElement>(`[aria-roledescription="slide"][aria-label^="${n} of 3"]`)!;

function setReducedMotion(matches: boolean) {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => ({
    ...original(query),
    matches: query.includes('reduce') ? matches : false,
  });
  return () => {
    window.matchMedia = original;
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.API_INTERNAL_URL;
});

describe('signature looks carousel', () => {
  it('ships five looks with photos', () => {
    expect(LOOKS).toHaveLength(5);
    for (const look of LOOKS) expect(look.image).toMatch(/^\/looks\/.+\.webp$/);
  });

  it('is a labelled carousel; one slide visible, linked to its service and live price', () => {
    render(<LooksCarousel services={services} looks={looks} />);
    expect(screen.getByRole('region', { name: 'Signature looks' })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
    expect(slide(1)).not.toHaveAttribute('aria-hidden', 'true');
    expect(slide(2)).toHaveAttribute('aria-hidden', 'true');
    const first = within(slide(1));
    expect(first.getByText('Precision Cut')).toBeInTheDocument();
    expect(first.getByText('from ₹400.00')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Book this look' })).toHaveAttribute(
      'href',
      `/book?services=${ids.haircut}`,
    );
  });

  it('a look whose service is gone links to the catalogue and shows no price', async () => {
    const user = userEvent.setup();
    render(<LooksCarousel services={services} looks={looks} />);
    await user.click(screen.getByRole('button', { name: 'Show look 2: Old Look' }));
    const second = within(slide(2));
    expect(slide(2)).not.toHaveAttribute('aria-hidden', 'true');
    expect(second.queryByText(/from/)).not.toBeInTheDocument();
    expect(second.getByRole('link', { name: 'Book this look' })).toHaveAttribute(
      'href',
      '/services',
    );
    expect(screen.getByRole('button', { name: 'Show look 2: Old Look' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('previous / next wrap around', async () => {
    const user = userEvent.setup();
    render(<LooksCarousel services={services} looks={looks} />);
    await user.click(screen.getByRole('button', { name: 'Previous look' }));
    expect(slide(3)).not.toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'Next look' }));
    expect(slide(1)).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('auto-rotates every 5 s until paused, and not while hovered or focused', () => {
    vi.useFakeTimers();
    render(<LooksCarousel services={services} looks={looks} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(slide(2)).not.toHaveAttribute('aria-hidden', 'true');

    const region = screen.getByRole('region', { name: 'Signature looks' });
    fireEvent.mouseEnter(region);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(slide(2)).not.toHaveAttribute('aria-hidden', 'true');
    fireEvent.mouseLeave(region);

    fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(slide(2)).not.toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Play slideshow' })).toBeInTheDocument();
  });

  it('swipes change slides; small drags do not', () => {
    render(<LooksCarousel services={services} looks={looks} />);
    const stage = slide(1).parentElement!.parentElement!;
    fireEvent.pointerDown(stage, { clientX: 200 });
    fireEvent.pointerUp(stage, { clientX: 100 });
    expect(slide(2)).not.toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerDown(stage, { clientX: 100 });
    fireEvent.pointerUp(stage, { clientX: 220 });
    expect(slide(1)).not.toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerDown(stage, { clientX: 100 });
    fireEvent.pointerUp(stage, { clientX: 110 });
    fireEvent.pointerUp(stage, { clientX: 400 });
    expect(slide(1)).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('never moves under prefers-reduced-motion (and offers no pause button)', () => {
    const restore = setReducedMotion(true);
    vi.useFakeTimers();
    render(<LooksCarousel services={services} looks={looks} />);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(slide(1)).not.toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: /slideshow/ })).not.toBeInTheDocument();
    restore();
  });

  it('renders nothing without looks', () => {
    const { container } = render(<LooksCarousel services={services} looks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('products we trust (brand strip)', () => {
  it('lists each brand once for assistive tech; the loop copy is hidden', () => {
    render(<BrandMarquee />);
    const lists = screen.getAllByRole('list', { hidden: true });
    expect(lists).toHaveLength(2);
    expect(lists[1]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('aria-label'))).toEqual(
      BRANDS.map((b) => b.name),
    );
  });
});

describe('location page', () => {
  it('address, contact, hours, directions and a map', async () => {
    useBackend();
    render(await LocationPage());
    expect(screen.getByRole('heading', { level: 1, name: 'Visit the salon' })).toBeInTheDocument();
    expect(screen.getByText('12 MG Road, Bengaluru')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Get directions/ })).toHaveAttribute(
      'href',
      directionsUrl('12 MG Road, Bengaluru'),
    );
    expect(screen.getByRole('link', { name: /Get directions/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByTitle(/Map showing/)).toHaveAttribute(
      'src',
      mapEmbedUrl('12 MG Road, Bengaluru'),
    );
    expect(screen.getByRole('link', { name: /Book here/ })).toHaveAttribute('href', '/book');
    expect(screen.getAllByText('9:30 AM – 8:30 PM').length).toBeGreaterThan(0);
  });

  it('without an address: no map or directions', async () => {
    useBackend();
    server.use(
      http.get(backend('/settings/public'), () =>
        HttpResponse.json({ ...settings, address: undefined }),
      ),
    );
    render(await LocationPage());
    expect(screen.getByRole('heading', { level: 1, name: 'Visit the salon' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Get directions/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Map showing/)).not.toBeInTheDocument();
  });

  it('falls back when the API is down', async () => {
    useBackend();
    server.use(http.get(backend('/settings/public'), () => problem(500, 'INTERNAL_ERROR')));
    render(await LocationPage());
    expect(screen.getByRole('heading', { name: "We'll be right back" })).toBeInTheDocument();
  });

  it('map links encode the address', () => {
    expect(directionsUrl('12 MG Rd, B&lore')).toBe(
      'https://www.google.com/maps/search/?api=1&query=12%20MG%20Rd%2C%20B%26lore',
    );
    expect(mapEmbedUrl('A B')).toBe('https://maps.google.com/maps?q=A%20B&z=15&output=embed');
  });
});
