import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { PwaRegister } from '@/components/layout/pwa-register';
import { ThemeProvider } from '@/components/layout/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Payment Desk — Internal Payment Approval & Execution Desk',
  description: 'Digital payment authorization, bank reconciliation, and UTR tracking for INDFURN and VINMORE.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.png?v=3', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.png?v=3',
    apple: '/apple-touch-icon.png?v=3',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Payment Desk',
  },
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e11' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

const themeBootScript = `(function(){try{var p=localStorage.getItem('payment-desk-theme');if(p!=='light'&&p!=='dark'&&p!=='system'){p='system';}var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';var c=d?'#0e0e11':'#ffffff';var ms=document.querySelectorAll('meta[name="theme-color"]');if(ms.length){for(var i=0;i<ms.length;i++){ms[i].setAttribute('content',c);ms[i].removeAttribute('media');}}else{var m=document.createElement('meta');m.name='theme-color';m.content=c;document.head.appendChild(m);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="h-full bg-[#F8FAFC] text-[#0F172A] font-sans selection:bg-rose-100 selection:text-rose-950">
        <ThemeProvider>
          <PwaRegister />
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 3500,
              className: 'border border-slate-200 text-xs shadow-lg font-sans',
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
