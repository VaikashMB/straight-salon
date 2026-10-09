import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// "Products we trust": an auto-scrolling strip of product-brand wordmarks. The brands are
// fictional and the marks are drawn here (no third-party logos or trademarks). Each mark is a
// labelled image; the strip is a list read once, and its duplicate (which makes the loop
// seamless) is hidden from assistive technology. Hovering pauses it; under
// prefers-reduced-motion it does not move.

const display = { fontFamily: 'var(--font-display), sans-serif' };
const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };

interface Brand {
  name: string;
  width: number;
  mark: ReactNode;
}

export const BRANDS: readonly Brand[] = [
  {
    name: 'Aurelia',
    width: 168,
    mark: (
      <>
        <path
          d="M14 30c0-11 7-19 16-22-2 9-6 17-16 22Zm0 0c-1-8 2-15 8-19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <text x="40" y="29" fontSize="21" letterSpacing="5" style={serif}>
          AURELIA
        </text>
      </>
    ),
  },
  {
    name: 'Noir & Co.',
    width: 150,
    mark: (
      <text x="4" y="30" fontSize="27" fontWeight="700" letterSpacing="-1" style={display}>
        noir&amp;co
        <tspan fill="var(--accent)">.</tspan>
      </text>
    ),
  },
  {
    name: 'Velour Professional',
    width: 150,
    mark: (
      <>
        <text
          x="75"
          y="22"
          fontSize="22"
          fontWeight="300"
          letterSpacing="7"
          textAnchor="middle"
          style={display}
        >
          VELOUR
        </text>
        <text x="75" y="36" fontSize="7.5" letterSpacing="3.4" textAnchor="middle" style={display}>
          PROFESSIONAL
        </text>
      </>
    ),
  },
  {
    name: 'Kerasoul',
    width: 160,
    mark: (
      <>
        <path
          d="M17 7c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <text x="34" y="30" fontSize="26" fontStyle="italic" style={serif}>
          Kerasoul
        </text>
      </>
    ),
  },
  {
    name: 'Lumière Botanics',
    width: 150,
    mark: (
      <>
        <text x="75" y="21" fontSize="20" letterSpacing="4" textAnchor="middle" style={serif}>
          LUMIÈRE
        </text>
        <line x1="40" y1="27" x2="110" y2="27" stroke="currentColor" strokeWidth="0.8" />
        <text
          x="75"
          y="38"
          fontSize="9"
          fontStyle="italic"
          letterSpacing="2"
          textAnchor="middle"
          style={serif}
        >
          botanics
        </text>
      </>
    ),
  },
  {
    name: 'Oslo Grooming Co.',
    width: 170,
    mark: (
      <>
        <circle cx="19" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
        <text x="19" y="25" fontSize="13" fontWeight="800" textAnchor="middle" style={display}>
          O
        </text>
        <text x="42" y="22" fontSize="20" fontWeight="800" letterSpacing="2" style={display}>
          OSLO
        </text>
        <text x="42" y="34" fontSize="7.5" letterSpacing="2.2" style={display}>
          GROOMING CO.
        </text>
      </>
    ),
  },
];

function BrandMark({ brand }: { brand: Brand }) {
  return (
    <svg
      role="img"
      aria-label={brand.name}
      viewBox={`0 0 ${brand.width} 40`}
      className="h-9 w-auto shrink-0 fill-current text-muted-foreground transition-colors duration-300 hover:text-foreground sm:h-10"
    >
      {brand.mark}
    </svg>
  );
}

function BrandList({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center gap-14 pr-14 sm:gap-20 sm:pr-20"
    >
      {BRANDS.map((brand) => (
        <li key={brand.name}>
          <BrandMark brand={brand} />
        </li>
      ))}
    </ul>
  );
}

export function BrandMarquee({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'group relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]',
        className,
      )}
    >
      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
        <BrandList />
        <BrandList hidden />
      </div>
    </div>
  );
}
