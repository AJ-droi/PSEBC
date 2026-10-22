import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RegisterSW } from '@/components/register-sw';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PSEBC Lifts', template: '%s · PSEBC Lifts' },
  description: 'Safe lifts to Princes Street Church from checked volunteer drivers.',
  applicationName: 'PSEBC Lifts',
  appleWebApp: { capable: true, title: 'PSEBC Lifts', statusBarStyle: 'default' },
  icons: { icon: '/favicon.png', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#1E4927',
  width: 'device-width',
  initialScale: 1,
  // No maximum-scale: people must be able to zoom (WCAG 1.4.4).
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
