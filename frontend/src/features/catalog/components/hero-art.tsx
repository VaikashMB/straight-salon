import { cn } from '@/lib/utils';

// Decorative line art for the home hero: open scissors inside a monogram ring, drawn in brass.
// No photos exist for the salon, so the hero stays illustration-only.
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 400 400"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('text-accent', className)}
    >
      {/* Monogram rings */}
      <circle cx="200" cy="200" r="184" strokeWidth="1" opacity="0.55" />
      <circle cx="200" cy="200" r="168" strokeWidth="1" strokeDasharray="1 7" opacity="0.8" />
      <circle cx="200" cy="200" r="120" strokeWidth="0.75" opacity="0.25" />
      {/* Scissors: two blades crossing at the pivot, finger rings below */}
      <path d="M168 272 L198 196 Q226 128 256 62 Q238 134 211 203 L184 279" strokeWidth="2.25" />
      <path d="M232 272 L202 196 Q174 128 144 62 Q162 134 189 203 L216 279" strokeWidth="2.25" />
      <circle cx="152" cy="304" r="30" strokeWidth="2.25" />
      <circle cx="152" cy="304" r="21" strokeWidth="0.75" opacity="0.6" />
      <circle cx="248" cy="304" r="30" strokeWidth="2.25" />
      <circle cx="248" cy="304" r="21" strokeWidth="0.75" opacity="0.6" />
      <circle cx="200" cy="198" r="6" strokeWidth="2.25" />
      {/* Sparkles */}
      <path d="M318 112 v20 M308 122 h20" strokeWidth="1.25" />
      <path d="M88 150 v14 M81 157 h14" strokeWidth="1" opacity="0.8" />
      <path d="M300 300 v10 M295 305 h10" strokeWidth="1" opacity="0.7" />
    </svg>
  );
}
