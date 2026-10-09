import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  applyThemePreference,
  nextThemePreference,
  readThemePreference,
  subscribeToThemePreference,
  THEME_STORAGE_KEY,
  themeInitScript,
} from '@/lib/theme';

const root = document.documentElement;

afterEach(() => {
  window.localStorage.clear();
  delete root.dataset.theme;
  vi.restoreAllMocks();
});

describe('theme preference (05 §2)', () => {
  it('defaults to system and ignores unknown stored values', () => {
    expect(readThemePreference()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });

  it('pins light/dark on <html> and in storage; system removes both', () => {
    applyThemePreference('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(readThemePreference()).toBe('dark');
    applyThemePreference('system');
    expect(root.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('still applies the theme when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    applyThemePreference('light');
    expect(root.dataset.theme).toBe('light');
    expect(readThemePreference()).toBe('system');
  });

  it('cycles system → light → dark → system', () => {
    expect(nextThemePreference('system')).toBe('light');
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('system');
  });

  it('follows a change made in another tab', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToThemePreference(onChange);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(root.dataset.theme).toBe('dark');
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(root.dataset.theme).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('the pre-paint script applies only a pinned theme', () => {
    // The script is a string that the layout inlines into <head>; running it is the test.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const runScript = new Function(themeInitScript) as () => void;
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runScript();
    expect(root.dataset.theme).toBe('dark');
    delete root.dataset.theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, 'nope');
    runScript();
    expect(root.dataset.theme).toBeUndefined();
  });

  it('the toggle names the current and next theme and cycles on click', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole('button', {
      name: 'System theme. Switch to light theme',
    });
    await user.click(button);
    expect(root.dataset.theme).toBe('light');
    expect(button).toHaveAccessibleName('Light theme. Switch to dark theme');
    await user.click(button);
    expect(root.dataset.theme).toBe('dark');
    await user.click(button);
    expect(root.dataset.theme).toBeUndefined();
    expect(button).toHaveAccessibleName('System theme. Switch to light theme');
  });
});
