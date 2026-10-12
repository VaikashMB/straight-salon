import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import GalleryPage, { metadata } from '@/app/(public)/gallery/page';
import { GalleryGrid } from '@/features/gallery/components/gallery-grid';
import {
  isLookCategory,
  LOOK_CATEGORIES,
  LOOKS,
  looksForCategories,
  looksIn,
  type Look,
} from '@/features/gallery/looks';

const looks: Look[] = [
  {
    src: '/a.webp',
    title: 'Fade',
    alt: 'A fade',
    category: 'hair',
    service: 'haircut',
    width: 900,
    height: 1200,
  },
  { src: '/b.webp', title: 'Beard', alt: 'A beard', category: 'beard', width: 900, height: 900 },
  {
    src: '/c.webp',
    title: 'Nails',
    alt: 'Gel nails',
    category: 'nails',
    service: 'gel-polish',
    width: 900,
    height: 600,
  },
];

const search = (category?: string) => ({ searchParams: Promise.resolve({ category }) });

describe('lookbook data', () => {
  it('every look has a known category, a real size and a unique photo', () => {
    const categories = new Set(LOOK_CATEGORIES.map((c) => c.value));
    for (const look of LOOKS) {
      expect(categories.has(look.category)).toBe(true);
      expect(look.width).toBeGreaterThan(0);
      expect(look.height).toBeGreaterThan(0);
      expect(look.alt.length).toBeGreaterThan(5);
    }
    expect(new Set(LOOKS.map((l) => l.src)).size).toBe(LOOKS.length);
  });

  it('filters by category and recognises category values', () => {
    expect(looksIn()).toBe(LOOKS);
    expect(looksIn('nails').every((l) => l.category === 'nails')).toBe(true);
    expect(isLookCategory('beard')).toBe(true);
    expect(isLookCategory('skin')).toBe(false);
    expect(isLookCategory(undefined)).toBe(false);
  });

  it('picks looks for a stylist from the categories they work in', () => {
    const nails = looksForCategories(['Skin', 'Nails']);
    expect(nails.length).toBeGreaterThan(0);
    expect(nails.every((l) => l.category === 'nails')).toBe(true);
    const barber = looksForCategories(['Hair', 'Beard & Grooming'], 4);
    expect(barber).toHaveLength(4);
    expect(barber.every((l) => l.category === 'hair' || l.category === 'beard')).toBe(true);
    expect(looksForCategories(['Massage'])).toEqual([]);
  });
});

describe('gallery grid and lightbox', () => {
  it('opens a look large, steps with buttons and arrow keys, and links to its service', async () => {
    render(<GalleryGrid looks={looks} />);
    const user = userEvent.setup();
    expect(screen.getAllByRole('button', { name: /^View .* larger$/ })).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'View Fade larger' }));
    const dialog = screen.getByRole('dialog', { name: 'Fade' });
    expect(within(dialog).getByText('Hair · 1 of 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Book this look/ })).toHaveAttribute(
      'href',
      '/services/haircut',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Next look' }));
    expect(screen.getByRole('dialog', { name: 'Beard' })).toBeInTheDocument();
    // No service behind this look, so no booking link.
    expect(screen.queryByRole('link', { name: /Book this look/ })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Nails' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Fade' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'Nails' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Nails' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Previous look' }),
    );
    expect(screen.getByRole('dialog', { name: 'Beard' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a single look has no previous/next; an empty list says so', async () => {
    const { unmount } = render(<GalleryGrid looks={[looks[0]!]} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Fade larger' }));
    expect(screen.queryByRole('button', { name: 'Next look' })).not.toBeInTheDocument();
    unmount();
    render(<GalleryGrid looks={[]} />);
    expect(screen.getByText('No looks in this category yet.')).toBeInTheDocument();
  });
});

describe('gallery page (/gallery)', () => {
  it('shows every look with "All" current, and filters by ?category=', async () => {
    expect(metadata.title).toBe('Gallery');
    const { unmount } = render(await GalleryPage(search()));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Looks we love');
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: /^View .* larger$/ })).toHaveLength(LOOKS.length);
    unmount();

    render(await GalleryPage(search('nails')));
    expect(screen.getByRole('link', { name: 'Nails' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('button', { name: /^View .* larger$/ })).toHaveLength(
      looksIn('nails').length,
    );
  });

  it('ignores an unknown category', async () => {
    render(await GalleryPage(search('massage')));
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
  });
});
