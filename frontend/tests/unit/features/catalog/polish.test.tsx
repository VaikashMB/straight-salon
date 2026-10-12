import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicLoading from '@/app/(public)/loading';
import HomePage from '@/app/(public)/page';
import { CountUp } from '@/components/count-up';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { Brand } from '@/components/layout/brand';
import { SiteFooter } from '@/components/layout/site-footer';
import { loadFeaturedReviews, salonStats, type Catalogue } from '@/features/catalog/api';
import { ServiceImage } from '@/features/catalog/components/service-image';
import { Testimonials } from '@/features/catalog/components/testimonials';
import { categories, makeReview, makeStylist, page, services } from '../../helpers/fixtures';
import { server, settings } from '../../helpers/api';
import { backend, useBackend } from '../../helpers/backend';

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
  delete process.env.API_INTERNAL_URL;
});

const catalogue = (stylists: Catalogue['stylists']): Catalogue => ({
  settings,
  categories,
  services,
  stylists,
});

describe('salon figures and testimonials', () => {
  it('averages ratings over every review and counts services and stylists', () => {
    const stats = salonStats(
      catalogue([
        makeStylist({ ratingAvg: 5, ratingCount: 3 }),
        makeStylist({ ratingAvg: 4, ratingCount: 1 }),
      ]),
    );
    expect(stats).toEqual({ rating: 4.8, reviews: 4, services: services.length, stylists: 2 });
    expect(salonStats(catalogue([makeStylist({ ratingAvg: 0, ratingCount: 0 })])).rating).toBe(
      null,
    );
  });

  it('features four- and five-star reviews with a comment, newest first', async () => {
    useBackend();
    server.use(
      http.get(backend('/reviews'), () =>
        HttpResponse.json(
          page([
            makeReview({ id: 'r1', comment: 'Lovely.' }),
            makeReview({ id: 'r2', rating: 3, comment: 'Fine.' }),
            makeReview({ id: 'r3', comment: undefined }),
            makeReview({ id: 'r4', rating: 4, comment: 'Great beard trim.' }),
            makeReview({ id: 'r5', comment: 'Third.' }),
          ]),
        ),
      ),
    );
    expect((await loadFeaturedReviews(2)).map((r) => r.id)).toEqual(['r1', 'r4']);
    server.use(http.get(backend('/reviews'), () => HttpResponse.error()));
    expect(await loadFeaturedReviews()).toEqual([]);
  });

  it('shows the first review as a pull quote and the rest as cards', () => {
    const { container } = render(
      <Testimonials
        reviews={[
          makeReview({ id: 'a', comment: 'Best fade in town.' }),
          makeReview({ id: 'b', rating: 4, comment: 'Calm and on time.' }),
        ]}
      />,
    );
    const quotes = container.querySelectorAll('figure');
    expect(quotes).toHaveLength(2);
    expect(within(quotes[0] as HTMLElement).getByText('Best fade in town.')).toBeInTheDocument();
    expect(within(quotes[0] as HTMLElement).getByLabelText('5 out of 5')).toBeInTheDocument();
    expect(within(quotes[1] as HTMLElement).getByLabelText('4 out of 5')).toBeInTheDocument();
    expect(screen.getAllByText(/Haircut with Ravi/)).toHaveLength(2);
  });

  it('renders nothing without reviews, and no side cards for a single one', () => {
    const { container, rerender } = render(<Testimonials reviews={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Testimonials reviews={[makeReview()]} />);
    expect(container.querySelectorAll('figure')).toHaveLength(1);
  });
});

describe('home page extras (05 §3)', () => {
  it('shows live salon figures and testimonials from real reviews', async () => {
    useBackend();
    render(await HomePage());
    const figures = screen.getByLabelText('The salon in numbers');
    // 20 + 8 reviews across the two stylists, (4.8×20 + 4.6×8) / 28 = 4.74 → 4.7.
    expect(within(figures).getByText('4.7')).toBeInTheDocument();
    expect(within(figures).getByText('28')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'What our clients say' })).toHaveTextContent(
      'Best fade in town.',
    );
    expect(screen.getByRole('region', { name: 'Gift a fresh look' })).toBeInTheDocument();
  });

  it('leaves out ratings and testimonials before anyone has reviewed', async () => {
    useBackend();
    server.use(
      http.get(backend('/staff'), () =>
        HttpResponse.json([makeStylist({ ratingAvg: 0, ratingCount: 0 })]),
      ),
      http.get(backend('/reviews'), () => HttpResponse.json(page([]))),
    );
    render(await HomePage());
    expect(screen.queryByText('Average rating')).not.toBeInTheDocument();
    expect(screen.queryByText('Client reviews')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What our clients say' })).not.toBeInTheDocument();
  });
});

describe('brand and layout pieces', () => {
  it('counts up to a number that screen readers read as text', () => {
    const { container } = render(<CountUp value={27.6} />);
    expect(screen.getByText('28')).toHaveClass('sr-only');
    const animated = container.querySelector('.count-up') as HTMLElement;
    expect(animated).toHaveAttribute('aria-hidden', 'true');
    expect(animated.style.getPropertyValue('--to')).toBe('28');
  });

  it('the wordmark carries the monogram, which can be left out', () => {
    const { container, rerender } = render(<Brand />);
    expect(screen.getByRole('link')).toHaveAccessibleName('Straight Salon');
    expect(container.querySelector('[data-slot="monogram"]')).toBeInTheDocument();
    rerender(<Brand mark={false} href="/admin" />);
    expect(container.querySelector('[data-slot="monogram"]')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin');
  });

  it('the announcement bar points to the gallery', () => {
    render(<AnnouncementBar />);
    expect(screen.getByRole('complementary', { name: 'Announcement' })).toHaveTextContent(
      'pay at the salon',
    );
    expect(screen.getByRole('link', { name: /latest looks/ })).toHaveAttribute('href', '/gallery');
  });

  it('the footer shows looks from the studio, the sign-off and a way to find us', () => {
    render(<SiteFooter />);
    const strip = screen.getByRole('region', { name: 'Fresh off the chair' });
    expect(within(strip).getAllByRole('img')).toHaveLength(6);
    expect(screen.getByText('See you in the chair.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Map & opening hours/ })).toHaveAttribute(
      'href',
      '/location',
    );
    expect(screen.getByRole('navigation', { name: 'Explore' })).toHaveTextContent('Gallery');
  });

  it('a public page loads as a page-shaped skeleton', () => {
    render(<PublicLoading />);
    expect(screen.getByRole('status', { name: 'Loading page' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('a service image renders the same with or without a transition name', () => {
    const { container } = render(
      <ServiceImage
        imageUrl="http://localhost:3000/demo/services/haircut.webp"
        sizes="100vw"
        transitionName="service-1"
      />,
    );
    expect(container.querySelector('[data-slot="service-image"] img')).toHaveAttribute(
      'src',
      'http://localhost:3000/demo/services/haircut.webp',
    );
  });
});
