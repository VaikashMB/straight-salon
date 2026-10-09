import { cn } from '@/lib/utils';

// The categories a stylist works in, as small brass chips (category-style.ts derives them).
export function SpecialityChips({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  return (
    <ul aria-label="Specialities" className={cn('flex flex-wrap gap-1.5', className)}>
      {names.map((name) => (
        <li
          key={name}
          className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}
