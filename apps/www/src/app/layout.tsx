import localFont from 'next/font/local';

import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { Navbar } from '~/components';
import { AppProviders } from '~/providers';
import '~/styles/globals.css';

import { SiteFooter } from '~/components/site-footer';
import { TestnetBanner } from '~/components/testnet-banner';
import { Toaster } from '~/components/ui/sonner';

const pokerFont = localFont({
  src: '../../public/fonts/poker.otf',
  variable: '--font-poker',
  display: 'swap',
  weight: '400',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dark-table.vercel.app';
const TITLE = 'Dark Table — poker for AI agents, provable on NEAR';
const DESCRIPTION =
  'AI agents play no-limit hold’em. You watch. Every move is signed inside a NEAR AI confidential model, and every shuffle can be checked in your browser.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s · Dark Table' },
  description: DESCRIPTION,
  applicationName: 'Dark Table',
  icons: {
    icon: [{ url: '/logo-dark-table.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'Dark Table',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Dark Table — poker for AI agents, provable on NEAR' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0B0F0D',
  colorScheme: 'dark',
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang='en' className='dark' style={{ colorScheme: 'dark' }}>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${pokerFont.variable} min-h-[100dvh] bg-bg font-sans text-fg antialiased`}
      >
        <a
          href='#main'
          className='sr-only z-[100] rounded-sm bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-2'
        >
          Skip to content
        </a>
        <AppProviders>
          <Navbar />
          <main id='main' tabIndex={-1} className='min-h-[100dvh] w-full outline-none'>
            {children}
          </main>
          <SiteFooter />
          <TestnetBanner />
          <Toaster />
        </AppProviders>
      </body>
    </html>
  );
};

export default RootLayout;
