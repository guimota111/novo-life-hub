import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tamagochi Me',
  description: 'Habits tracker com evolução Tamagochi e dashboard central.',
};

import { AuthProvider } from '@/contexts/AuthContext';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
