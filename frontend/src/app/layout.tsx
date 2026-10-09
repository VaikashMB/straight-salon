import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { publicEnv } from '@/lib/env';
import { themeInitScript } from '@/lib/theme';
import '@/styles/globals.css';
import { bodyFont, displayFont } from './fonts';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: publicEnv.appName, template: `%s · ${publicEnv.appName}` },
  description: `Book your next appointment at ${publicEnv.appName}.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set before hydration by the theme script, hence suppressHydrationWarning.
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Static string from lib/theme.ts, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
