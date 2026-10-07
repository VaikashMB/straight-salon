import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/(public)/page';
import ServicePage, {
  generateMetadata as serviceMetadata,
} from '@/app/(public)/services/[slug]/page';
import ServicesPage from '@/app/(public)/services/page';
import StylistPage, {
  generateMetadata as stylistMetadata,
} from '@/app/(public)/stylists/[id]/page';
import StylistsPage from '@/app/(public)/stylists/page';
import { problem, server } from '../../helpers/api';
import { backend, useBackend } from '../../helpers/backend';
import { ids, makeService, makeStylist, services } from '../../helpers/fixtures';
import { notFound } from '../../helpers/next-navigation';

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
}));

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

afterEach(() => {
  delete process.env.API_INTERNAL_URL;
});

describe('public catalogue pages (05 §3, §6)', () => {
  it('home: hero, popular services, the team and opening hours', async () => {
    useBackend();
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Book in under a minute');
    expect(screen.getByRole('link', { name: /Book now/ })).toHaveAttribute('href', '/book');
    const popular = screen.getByRole('region', { name: 'Popular services' });
    // Most-reviewed first.
    expect(
      within(popular)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Haircut', 'Hair Colour', 'Beard Trim']);
    expect(within(popular).getByRole('link', { name: 'Book Haircut' })).toHaveAttribute(
      'href',
      `/book?services=${ids.haircut}`,
    );
    expect(screen.getByRole('link', { name: 'Book with Ravi' })).toHaveAttribute(
      'href',
      `/book?staff=${ids.ravi}`,
    );
    expect(screen.getByText('12 MG Road, Bengaluru')).toBeInTheDocument();
    expect(screen.getAllByText('09:30 – 20:30')).toHaveLength(7);
  });

  it('shows a friendly fallback when the API is down', async () => {
    useBackend();
    server.use(http.get(backend('/services'), () => problem(500, 'INTERNAL_ERROR')));
    render(await HomePage());
    expect(screen.getByRole('heading', { name: "We'll be right back" })).toBeInTheDocument();
    render(await ServicesPage());
    render(await StylistsPage());
    expect(screen.getAllByRole('heading', { name: "We'll be right back" })).toHaveLength(3);
  });

  it('services: category tabs and name search (FR-012)', async () => {
    useBackend();
    render(await ServicesPage());
    const user = userEvent.setup();
    const names = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names()).toEqual(['Haircut', 'Beard Trim', 'Hair Colour']);
    await user.click(screen.getByRole('tab', { name: 'Beard & Grooming' }));
    expect(names()).toEqual(['Beard Trim']);
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'hair col');
    expect(names()).toEqual(['Hair Colour']);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'massage');
    expect(screen.getByText('No services match')).toBeInTheDocument();
  });

  it('service detail: price, duration, stylists and reviews (API-024, API-061)', async () => {
    useBackend();
    server.use(
      http.get(backend('/services/:slug'), ({ params: p }) =>
        p.slug === 'haircut'
          ? HttpResponse.json({
              ...makeService({ imageUrl: 'http://localhost:4000/uploads/a.webp' }),
              stylists: [{ id: ids.ravi, displayName: 'Ravi', ratingAvg: 4.8, ratingCount: 20 }],
            })
          : problem(404, 'NOT_FOUND'),
      ),
    );
    render(await ServicePage(params({ slug: 'haircut' })));
    expect(screen.getByRole('heading', { level: 1, name: 'Haircut' })).toBeInTheDocument();
    expect(screen.getByText('₹400.00')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ravi' })).toHaveAttribute(
      'href',
      `/stylists/${ids.ravi}`,
    );
    expect(screen.getByText('Best fade in town.')).toBeInTheDocument();
    expect(screen.getByLabelText('5 out of 5')).toBeInTheDocument();
    await expect(serviceMetadata(params({ slug: 'haircut' }))).resolves.toMatchObject({
      title: 'Haircut',
    });

    render(await ServicePage(params({ slug: 'missing' })));
    expect(notFound).toHaveBeenCalled();
    await expect(serviceMetadata(params({ slug: 'missing' }))).resolves.toEqual({
      title: 'Service',
    });
  });

  it('stylists list and profile with services and reviews (API-030, API-031)', async () => {
    useBackend();
    server.use(
      http.get(backend('/staff/:id'), ({ params: p }) =>
        p.id === ids.ravi
          ? HttpResponse.json({ ...makeStylist(), services: services.slice(0, 2) })
          : problem(404, 'NOT_FOUND'),
      ),
    );
    render(await StylistsPage());
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Ravi',
      'Meera',
    ]);
    render(await StylistPage(params({ id: ids.ravi })));
    expect(screen.getByRole('heading', { level: 1, name: 'Ravi' })).toBeInTheDocument();
    expect(screen.getByText('Best fade in town.')).toBeInTheDocument();
    await expect(stylistMetadata(params({ id: ids.ravi }))).resolves.toMatchObject({
      title: 'Ravi',
    });
    render(await StylistPage(params({ id: ids.meera })));
    expect(notFound).toHaveBeenCalled();
    await expect(stylistMetadata(params({ id: ids.meera }))).resolves.toEqual({ title: 'Stylist' });
  });

  it('an empty team gets an empty state; an outage on a detail page shows the fallback', async () => {
    useBackend();
    server.use(
      http.get(backend('/staff'), () => HttpResponse.json([])),
      http.get(backend('/staff/:id'), () => problem(503, 'TEMPORARILY_UNAVAILABLE')),
      http.get(backend('/services/:slug'), () => problem(503, 'TEMPORARILY_UNAVAILABLE')),
    );
    render(await StylistsPage());
    expect(screen.getByText('Our team is being updated')).toBeInTheDocument();
    render(await StylistPage(params({ id: ids.ravi })));
    render(await ServicePage(params({ slug: 'haircut' })));
    expect(screen.getAllByRole('heading', { name: "We'll be right back" })).toHaveLength(2);
  });
});
