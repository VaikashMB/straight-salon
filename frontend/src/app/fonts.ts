import { Fraunces, Inter, Outfit } from 'next/font/google';

// 05 §2: an editorial serif for the big headlines (h1, h2, the wordmark), a geometric sans for
// smaller headings and figures, a neutral sans for body text. All self-hosted by next/font.
export const serifFont = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'opsz'],
  variable: '--font-fraunces',
});
export const displayFont = Outfit({ subsets: ['latin'], variable: '--font-display' });
export const bodyFont = Inter({ subsets: ['latin'], variable: '--font-body' });
