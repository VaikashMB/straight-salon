import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Placeholder home. The real one (hero, featured services, stylists, ISR) is Phase 9.
export default function HomePage() {
  return (
    <section className="mx-auto grid max-w-3xl gap-6 px-4 py-20 text-center">
      <h1 className="text-4xl font-semibold sm:text-5xl">Straight Salon</h1>
      <p className="text-lg text-muted-foreground">
        Online booking is coming soon. Create an account now and you&apos;ll be ready to book.
      </p>
      <div className="flex justify-center gap-3">
        <Button asChild>
          <Link href="/register">Create account</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </section>
  );
}
