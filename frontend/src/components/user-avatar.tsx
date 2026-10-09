import { cn } from '@/lib/utils';

// Up to two initials for the avatar: first and last word of the name.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

// Decorative initials circle for the signed-in user. The name is always shown or announced
// next to it, so the avatar itself is aria-hidden. `tone="sidebar"` for the always-dark sidebar.
export function UserAvatar({
  name,
  tone = 'default',
  className,
}: {
  name: string;
  tone?: 'default' | 'sidebar';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-content-center rounded-full text-sm font-semibold ring-1',
        tone === 'sidebar'
          ? 'bg-sidebar-accent/15 text-sidebar-accent ring-sidebar-accent/40'
          : 'bg-accent-soft text-accent-ink ring-accent/40',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
