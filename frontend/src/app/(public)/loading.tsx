import { Skeleton } from '@/components/ui/skeleton';

// Shown while a public page loads on navigation (05 §7): a skeleton in the shape of the page to
// come (title band, then cards with an image, a title, a line of text and a button), shimmering
// in brass.
export default function PublicLoading() {
  return (
    <output aria-busy="true" aria-label="Loading page" className="block">
      <div className="border-b bg-hero">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:py-16">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-3/4 max-w-xl" />
          <Skeleton className="h-0.5 w-12 bg-accent/50" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-2xl border bg-card shadow-soft"
            style={{ opacity: 1 - i * 0.2 }}
          >
            <Skeleton className="aspect-[16/9] rounded-none" />
            <div className="grid gap-3 p-5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="mt-2 h-8 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </output>
  );
}
