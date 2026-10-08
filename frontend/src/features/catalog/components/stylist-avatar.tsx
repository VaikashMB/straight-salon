import Image from 'next/image';
import { cn } from '@/lib/utils';

// A stylist's photo, or their initials when there is none. Uploaded images come from the API's
// storage URL (API-027), so Next's optimiser is bypassed for them.
export function StylistAvatar({
  name,
  photoUrl,
  size = 64,
  className,
}: {
  name: string;
  photoUrl?: string;
  size?: number;
  className?: string;
}) {
  if (photoUrl) {
    return (
      <Image
        src={photoUrl}
        alt=""
        width={size}
        height={size}
        unoptimized
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-content-center rounded-full bg-secondary font-heading font-semibold',
        className,
      )}
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials}
    </span>
  );
}
