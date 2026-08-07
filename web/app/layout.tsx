import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Airylio — Know When to Leave',
  description: 'Real-time departure planning for Philippine commuters.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Airylio',
  },
};

// themeColor belongs on the viewport export, not metadata - Next.js deprecated
// it there and warns on every build otherwise.
export const viewport: Viewport = {
  themeColor: '#4C4F9E',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
