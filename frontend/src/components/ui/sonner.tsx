'use client';

import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// The icon for each kind of toast: a small tinted disc, brass for success and info, the status
// colours for warnings and errors. Decorative: the title says what happened.
function ToastIcon({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`grid size-8 shrink-0 place-content-center rounded-full ring-1 [&>svg]:size-4 ${tone}`}
    >
      {children}
    </span>
  );
}

const ICONS: ToasterProps['icons'] = {
  success: (
    <ToastIcon tone="bg-accent-soft text-accent-ink ring-accent/35">
      <CircleCheck />
    </ToastIcon>
  ),
  info: (
    <ToastIcon tone="bg-accent-soft text-accent-ink ring-accent/35">
      <Info />
    </ToastIcon>
  ),
  warning: (
    <ToastIcon tone="bg-warning/12 text-warning ring-warning/30">
      <TriangleAlert />
    </ToastIcon>
  ),
  error: (
    <ToastIcon tone="bg-destructive/10 text-destructive ring-destructive/30">
      <CircleAlert />
    </ToastIcon>
  ),
  loading: (
    <ToastIcon tone="bg-muted text-muted-foreground ring-border">
      <LoaderCircle className="animate-spin" />
    </ToastIcon>
  ),
};

// Toasts (05 §1, §2), built from the theme tokens so they match the page they appear on: the
// card surface with a warm lifted shadow, a brass edge (red for errors, amber for warnings), a
// tinted icon disc, a semibold title and a muted description. Styled here in full (unstyled
// sonner), so they follow the site's light/dark toggle rather than the OS setting.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      closeButton
      gap={10}
      offset={20}
      icons={ICONS}
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group/toast relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border bg-card/95 py-3.5 pr-11 pl-4 font-sans text-card-foreground shadow-lift backdrop-blur-md before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent data-[type=error]:before:bg-destructive data-[type=warning]:before:bg-warning sm:w-[23rem]',
          icon: 'flex size-8 shrink-0 items-center justify-center [&>*]:shrink-0',
          content: 'grid min-w-0 flex-1 gap-0.5',
          title: 'text-sm leading-snug font-semibold tracking-tight',
          description: 'text-[0.8rem] leading-snug text-muted-foreground',
          closeButton:
            'absolute! top-1/2! right-3! left-auto! grid size-7 -translate-y-1/2! transform-none place-content-center rounded-full border-0! bg-transparent! text-muted-foreground transition-colors hover:bg-muted! hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>svg]:size-3.5',
          actionButton:
            'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90',
          cancelButton:
            'rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
