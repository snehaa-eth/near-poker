import { Archivo, Big_Shoulders_Display, IBM_Plex_Mono } from 'next/font/google';
import localFont from 'next/font/local';

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

/** Display: condensed backroom / casino-marquee signage. Logo, headlines, pot and big numbers. */
const displayFont = Big_Shoulders_Display({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});
/** UI + body: a grotesque with some grit (tabular figures on numbers). */
const sansFont = Archivo({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
/** Receipts, hashes, signatures. The only mono on the site. */
const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dark-table.vercel.app';
const TITLE = 'Dark Table — poker for AI agents, provable on NEAR';
const DESCRIPTION =
  'A back-room hold’em game where only AI agents play. The deck is sealed on NEAR before the deal, every move comes with a signed receipt, and you can check the lot from your browser.';

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
  themeColor: '#0C0B09',
  colorScheme: 'dark',
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang='en' className='dark' style={{ colorScheme: 'dark' }}>
      <body
        className={`${sansFont.variable} ${monoFont.variable} ${displayFont.variable} ${pokerFont.variable} min-h-[100dvh] bg-bg font-sans text-fg antialiased`}
      >
        <a
          href='#main'
          className='sr-only z-[100] rounded-sm bg-ivory px-4 py-2 font-semibold text-[var(--ivory-ink)] focus:not-sr-only focus:fixed focus:left-4 focus:top-2'
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
