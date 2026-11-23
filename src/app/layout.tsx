import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { PwaRegister } from '@/components/layout/pwa-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'INDFURN — Payment Approval & UTR Tracking System',
  description: 'Digital payment authorization, bank reconciliation, and UTR tracking for INDFURN.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'INDFURN Pay',
  },
};

export const viewport: Viewport = {
  themeColor: '#1E293B',
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
      <body className="h-full bg-[#F8FAFC] text-[#0F172A] font-sans selection:bg-slate-200 selection:text-slate-900">
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
