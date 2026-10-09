import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="relative isolate grid min-h-[70svh] place-content-center overflow-hidden bg-hero px-4 py-20">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grain" />
      <div className="grid max-w-md animate-fade-up justify-items-center gap-4 text-center">
        <p
          aria-hidden
          className="font-heading text-8xl leading-none font-semibold tracking-tighter text-accent-ink sm:text-9xl"
        >
          404
        </p>
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <div aria-hidden className="rule-brass" />
        <p className="text-muted-foreground">The page you were looking for does not exist.</p>
        <Button asChild variant="outline" size="lg">
          <Link href="/">
            <ArrowLeft aria-hidden /> Back to home
          </Link>
        </Button>
      </div>
    </main>
  );
}
