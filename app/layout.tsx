import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { PushProvider } from '@/contexts/PushContext';
import WakeLock from '@/components/WakeLock';
import QuickLogFab from '@/components/QuickLogFab';
import InstallPrompt from '@/components/InstallPrompt';

export const metadata: Metadata = {
  title: 'Tamagochi Me',
  description: 'Seus hábitos com evolução Tamagochi e dashboard central.',
  applicationName: 'Tamagochi Me',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Tamagochi Me',
  },
};

export const viewport: Viewport = {
  themeColor: '#08101a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <PushProvider>
            {children}
            <Suspense fallback={null}>
              <QuickLogFab />
            </Suspense>
            <InstallPrompt />
          </PushProvider>
        </AuthProvider>
        <WakeLock />
      </body>
    </html>
  );
}
