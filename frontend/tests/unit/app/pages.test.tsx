import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';

describe('error pages (05 §3)', () => {
  it('not found links back home', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });

  it('the error boundary offers a retry and hides details', async () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error('database password leaked')} reset={reset} />);
    expect(screen.queryByText(/database/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
