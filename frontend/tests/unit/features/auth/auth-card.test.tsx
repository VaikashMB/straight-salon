import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ForgotPasswordPage from '@/app/(public)/forgot-password/page';
import LoginPage from '@/app/(public)/login/page';
import RegisterPage from '@/app/(public)/register/page';
import { AuthCard } from '@/features/auth/components/auth-card';
import { setLocation } from '../../helpers/next-navigation';
import { renderWithProviders } from '../../helpers/render';

// The auth pages' frame (05 §2): a photo panel with the salon's mark, a serif line and three
// perks beside the form on large screens (CSS hides it on phones).

const panel = () => {
  const aside = screen.getByRole('complementary');
  return { aside, scene: aside.dataset.scene, text: aside.textContent };
};

describe('auth frame (05 §2)', () => {
  it('sign in: "welcome" scene with the studio photo and its perks', () => {
    setLocation('/login');
    renderWithProviders(<LoginPage />);
    const { aside, scene, text } = panel();
    expect(scene).toBe('welcome');
    expect(text).toContain('Your chair is waiting.');
    expect(within(aside).getAllByRole('listitem')).toHaveLength(3);
    expect(aside.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('register and password help have their own scenes', () => {
    setLocation('/register');
    const { unmount } = renderWithProviders(<RegisterPage />);
    expect(panel().scene).toBe('join');
    expect(panel().text).toContain('Look sharp, every visit.');
    unmount();
    setLocation('/forgot-password');
    renderWithProviders(<ForgotPasswordPage />);
    expect(panel().scene).toBe('help');
  });

  it('shows the description and footer only when given', () => {
    render(
      <AuthCard title="Plain">
        <p>Body</p>
      </AuthCard>,
    );
    expect(screen.getByRole('heading', { name: 'Plain' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(panel().scene).toBe('welcome');
  });
});
