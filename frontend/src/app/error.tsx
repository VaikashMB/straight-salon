'use client';

import { RotateCcw, Scissors } from 'lucide-react';
import { IconTile } from '@/components/icon-tile';
import { Button } from '@/components/ui/button';

// Unexpected rendering errors (05 §3). Details stay in the console/server logs, not on screen.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="relative isolate grid min-h-[70svh] place-content-center overflow-hidden bg-hero px-4 py-20">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grain" />
      <div className="grid max-w-md animate-fade-up justify-items-center gap-4 text-center">
        <IconTile icon={Scissors} size="lg" />
        <h1 className="text-3xl font-semibold">Something went wrong</h1>
        <div aria-hidden className="rule-brass" />
        <p className="text-muted-foreground">
          Please try again. If it keeps happening, call the salon.
        </p>
        <Button size="lg" onClick={reset}>
          <RotateCcw aria-hidden /> Try again
        </Button>
      </div>
    </main>
  );
}
