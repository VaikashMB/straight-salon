import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/(public)/page';
import NotFound from '@/app/not-found';

describe('HomePage', () => {
  it('shows the salon name as the main heading', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Straight Salon' })).toBeInTheDocument();
  });
});

describe('NotFound', () => {
  it('links back to the home page', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
