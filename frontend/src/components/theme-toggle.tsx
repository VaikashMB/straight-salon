'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  applyThemePreference,
  nextThemePreference,
  readThemePreference,
  subscribeToThemePreference,
  type ThemePreference,
} from '@/lib/theme';
import { cn } from '@/lib/utils';

const LABEL: Record<ThemePreference, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

// One button that cycles system → light → dark (05 §2). The label names the current theme and
// the next one, so the state is never conveyed by the icon alone.
export function ThemeToggle({ className }: { className?: string }) {
  // The stored choice is only readable in the browser; the server render shows "system".
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readThemePreference,
    () => 'system' as const,
  );

  const next = nextThemePreference(preference);
  const Icon = ICON[preference];
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('size-9', className)}
      aria-label={`${LABEL[preference]}. Switch to ${LABEL[next].toLowerCase()}`}
      title={`${LABEL[preference]} (click for ${LABEL[next].toLowerCase()})`}
      onClick={() => applyThemePreference(next)}
    >
      <Icon aria-hidden />
    </Button>
  );
}
