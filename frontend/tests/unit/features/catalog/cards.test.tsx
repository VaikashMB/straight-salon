import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceCard } from '@/features/catalog/components/service-card';
import { StylistCard } from '@/features/catalog/components/stylist-card';
import { categories, makeService, makeStylist } from '../../helpers/fixtures';

const image = (container: HTMLElement) => container.querySelector('[data-slot="service-image"]');
const placeholder = (container: HTMLElement) =>
  container.querySelector('[data-slot="service-placeholder"]');

describe('service card (FR-012)', () => {
  it('shows the uploaded image as a decorative header when the service has one', () => {
    const { container } = render(
      <ServiceCard
        service={makeService({ imageUrl: 'http://localhost:4000/uploads/a.webp' })}
        category={categories[0]}
      />,
    );
    expect(image(container)).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost:4000/uploads/a.webp',
    );
    expect(placeholder(container)).toBeNull();
  });

  it('without an image: a tinted category placeholder, the category name and a price pill', () => {
    const { container } = render(<ServiceCard service={makeService()} category={categories[0]} />);
    expect(container.querySelector('img')).toBeNull();
    expect(placeholder(container)).toHaveClass('bg-[#f0e2c8]');
    expect(screen.getByText('Hair')).toBeInTheDocument();
    expect(screen.getByText('₹400.00')).toHaveClass('rounded-full');
    expect(screen.getByRole('heading', { level: 3, name: 'Haircut' })).toBeInTheDocument();
  });

  it('an unknown category falls back to the brass placeholder and no label', () => {
    const { container } = render(<ServiceCard service={makeService()} headingLevel={2} />);
    expect(placeholder(container)).toHaveClass('bg-accent-soft');
    expect(screen.getByRole('heading', { level: 2, name: 'Haircut' })).toBeInTheDocument();
    expect(screen.queryByText('Hair')).not.toBeInTheDocument();
  });
});

describe('stylist card', () => {
  it('shows speciality chips when the page knows them', () => {
    render(<StylistCard stylist={makeStylist()} specialities={['Hair', 'Beard & Grooming']} />);
    const chips = screen.getByRole('list', { name: 'Specialities' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Hair', 'Beard & Grooming']);
    expect(screen.getByText('4.8')).toBeInTheDocument();
  });

  it('renders the photo with a brass ring, and no chips without specialities', () => {
    const { container } = render(
      <StylistCard stylist={makeStylist({ photoUrl: 'http://localhost:4000/uploads/r.webp' })} />,
    );
    expect(container.querySelector('img')).toHaveClass('ring-accent');
    expect(screen.queryByRole('list', { name: 'Specialities' })).not.toBeInTheDocument();
  });
});
