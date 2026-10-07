import { Inter, Outfit } from 'next/font/google';

// 05 §2: a geometric sans for headings, a neutral sans for body, self-hosted by next/font.
export const displayFont = Outfit({ subsets: ['latin'], variable: '--font-display' });
export const bodyFont = Inter({ subsets: ['latin'], variable: '--font-body' });
