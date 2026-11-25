import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { PwaRegister } from '@/components/layout/pwa-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'Payment Desk — Internal Payment Approval & Execution Desk',
  description: 'Digital payment authorization, bank reconciliation, and UTR tracking for INDFURN and VINMORE.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    shortcut: '/icon-192.png',
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Payment Desk',
  },
};

export const viewport: Viewport = {
  themeColor: '#7F1D1D',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-[#F8FAFC] antialiased">
      <body className="h-full bg-[#F8FAFC] text-[#0F172A] font-sans selection:bg-rose-100 selection:text-rose-950">
        <PwaRegister />
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 3500,
            className: 'border border-slate-200 text-xs shadow-lg font-sans',
          }}
        />
      </body>
    </html>
  );
}
