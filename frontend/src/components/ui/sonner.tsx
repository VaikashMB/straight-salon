'use client';

import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Toasts (05 §1). Follows the OS colour scheme like the rest of the theme.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      richColors
      closeButton
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
