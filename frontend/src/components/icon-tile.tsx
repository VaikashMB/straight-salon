import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZE = {
  sm: 'size-8 [&>svg]:size-4',
  md: 'size-10 [&>svg]:size-5',
  lg: 'size-14 [&>svg]:size-7',
} as const;

// A decorative icon in a soft brass circle (KPI cards, feature steps, empty states). The icon
// is always aria-hidden: the text next to it carries the meaning.
export function IconTile({
  icon: Icon,
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-content-center rounded-full bg-accent-soft text-accent-ink ring-1 ring-accent/25',
        SIZE[size],
        className,
      )}
    >
      <Icon />
    </span>
  );
}
