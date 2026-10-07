import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { publicEnv } from '@/lib/env';
import '@/styles/globals.css';
import { bodyFont, displayFont } from './fonts';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: publicEnv.appName, template: `%s · ${publicEnv.appName}` },
  description: `Book your next appointment at ${publicEnv.appName}.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
