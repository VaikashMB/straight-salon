import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { Category } from '../api';
import { categoryStyle } from '../category-style';

// A service's uploaded image (API-027), or a tinted placeholder with its category's icon. Both
// are decorative: the service name is the heading next to it. Uploaded images come from the
// API's storage URL, so Next's optimiser is bypassed for them (like the stylist avatar).
export function ServiceImage({
  imageUrl,
  category,
  sizes,
  className,
}: {
  imageUrl?: string;
  category?: Pick<Category, 'slug' | 'name'>;
  sizes: string;
  className?: string;
}) {
  const style = categoryStyle(category);
  const Icon = style.icon;
  return (
    <div
      aria-hidden
      data-slot={imageUrl ? 'service-image' : 'service-placeholder'}
      className={cn('relative overflow-hidden', !imageUrl && style.tint, className)}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={sizes}
          unoptimized
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <>
          {/* Fine concentric rings behind the icon, like a mirror in the salon. */}
          <svg
            viewBox="0 0 200 200"
            className={cn('absolute inset-0 m-auto h-[140%] opacity-25', style.ink)}
            fill="none"
            stroke="currentColor"
          >
            <circle cx="100" cy="100" r="40" strokeWidth="0.75" />
            <circle cx="100" cy="100" r="62" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="86" strokeWidth="0.35" strokeDasharray="2 4" />
          </svg>
          <span
            className={cn(
              'absolute inset-0 m-auto grid size-14 place-content-center rounded-full bg-card/80 shadow-soft ring-1 ring-accent/25 transition-transform duration-300 group-hover:scale-105 [&>svg]:size-7',
              style.ink,
            )}
          >
            <Icon />
          </span>
        </>
      )}
    </div>
  );
}
