'use client';

import { Button } from '@/components/ui/button';

// Unexpected rendering errors (05 §3). Details stay in the console/server logs, not on screen.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto grid min-h-[60svh] max-w-md place-content-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        Please try again. If it keeps happening, call the salon.
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
