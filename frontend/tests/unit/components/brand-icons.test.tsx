import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DropletLeafIcon,
  PolishIcon,
  RazorIcon,
  ShearsIcon,
  SparkleIcon,
} from '@/components/brand-icons';

describe("the salon's line icons (05 §2)", () => {
  it.each([
    ['shears', ShearsIcon],
    ['razor', RazorIcon],
    ['droplet-leaf', DropletLeafIcon],
    ['polish', PolishIcon],
    ['sparkle', SparkleIcon],
  ])('%s is a decorative 24px line icon that takes a class', (name, Icon) => {
    const { container } = render(<Icon className="size-5" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-icon', name);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
    expect(svg).toHaveClass('size-5');
  });
});
