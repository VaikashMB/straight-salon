import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';

describe('list states (05 §7)', () => {
  it('empty state: title, description, action and a decorative illustration', () => {
    const { container } = render(
      <EmptyState title="Nothing here" description="Try later." action={<button>Add</button>} />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Try later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    const art = container.querySelector('svg');
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art).toHaveAttribute('data-illustration', 'inbox');
  });

  it.each(['calendar', 'search', 'inbox'] as const)('the %s illustration', (variant) => {
    const { container } = render(<EmptyState title="Empty" illustration={variant} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-illustration', variant);
  });

  it('loading list is a busy, labelled output', () => {
    render(<LoadingList rows={2} label="Loading things" />);
    expect(screen.getByLabelText('Loading things')).toHaveAttribute('aria-busy', 'true');
  });

  it('error state retries', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('boom')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
