import type { ComponentType, SVGProps } from 'react';

// The salon's own thin-line icons (05 §2), drawn on a 24px grid with a 1.5 stroke like Lucide,
// so they sit next to Lucide icons and work anywhere one does (IconTile, category styles).
// Decorative: callers hide them from assistive tech and put the meaning in text.

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

// Open shears with finger rings.
export function ShearsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg data-icon="shears" {...props}>
      <circle cx="6" cy="17.5" r="2.75" />
      <circle cx="13.5" cy="19" r="2.25" />
      <path d="M8.2 15.6 20 4" />
      <path d="M12.4 17 18.5 6.5" />
      <path d="m14.6 11 1.2.9" />
    </Svg>
  );
}

// A straight razor, blade open.
export function RazorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg data-icon="razor" {...props}>
      <path d="M3.5 13.5 13 4a2.1 2.1 0 0 1 3 3l-6.5 6.5" />
      <path d="M3.5 13.5 9.5 13.5" />
      <path d="m13.5 9.5 6.3 6.3a1.5 1.5 0 0 1 0 2.1l-1.9 1.9a1.5 1.5 0 0 1-2.1 0L9.5 13.5" />
      <circle cx="17.5" cy="17.5" r="0.5" fill="currentColor" />
    </Svg>
  );
}

// A drop with a leaf vein, for skin care.
export function DropletLeafIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg data-icon="droplet-leaf" {...props}>
      <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />
      <path d="M12 20v-7" />
      <path d="m12 16 2.4-2.4" />
      <path d="m12 14.2-2-2" />
    </Svg>
  );
}

// A bottle of nail polish with its brush cap.
export function PolishIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg data-icon="polish" {...props}>
      <path d="M10 3h4v6h-4z" />
      <path d="M8.5 9h7a2 2 0 0 1 2 2v7.5a2.5 2.5 0 0 1-2.5 2.5H9a2.5 2.5 0 0 1-2.5-2.5V11a2 2 0 0 1 2-2Z" />
      <path d="M9.5 14.5h5" />
    </Svg>
  );
}

// A four-point sparkle with a small companion.
export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg data-icon="sparkle" {...props}>
      <path d="M11 3.5c.6 4 1.9 5.4 6 6-4.1.6-5.4 2-6 6-.6-4-1.9-5.4-6-6 4.1-.6 5.4-2 6-6Z" />
      <path d="M18.5 15.5c.3 1.6.8 2.1 2.5 2.5-1.7.4-2.2.9-2.5 2.5-.3-1.6-.8-2.1-2.5-2.5 1.7-.4 2.2-.9 2.5-2.5Z" />
    </Svg>
  );
}
