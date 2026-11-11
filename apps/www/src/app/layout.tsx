import localFont from 'next/font/local';

import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { Navbar } from '~/components';
import { RiskDisclaimerModal } from '~/components/risk-disclaimer-modal';
import { AppProviders } from '~/providers';
import '~/styles/globals.css';

import { Toaster } from '~/components/ui/sonner';

import { ThemeProvider } from '../providers/theme-provider';

const pokerFont = localFont({
  src: '../../public/fonts/poker.otf',
  variable: '--font-poker',
  display: 'swap',
  weight: '400',
});

export const metadata: Metadata = {
  title: "Texas Hold'em on Midnight",
  description:
    "Off-chain multiplayer Texas Hold'em on Midnight — wallet identity, NIGHT buy-in.",
  icons: [{ rel: 'icon', url: '/logo-midnight.png' }],
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang='en' className='light' style={{ colorScheme: 'light' }}>
      <body
        className={`min-h-[100dvh] bg-[#F7F7F8] font-sans text-neutral-950 antialiased ${GeistSans.variable} ${pokerFont.variable}`}
      >
        <ThemeProvider>
          <AppProviders>
            <Navbar />
            <main className='min-h-[100dvh] w-full'>{children}</main>
            <RiskDisclaimerModal />
            <Toaster theme='light' />
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default RootLayout;
