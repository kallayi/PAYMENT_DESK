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

const themeBootScript = `(function(){try{var p=localStorage.getItem('payment-desk-theme');if(p!=='light'&&p!=='dark'&&p!=='system'){p='system';}var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;var cs=d?'dark':'only light';r.classList.toggle('dark',d);r.classList.toggle('light',!d);r.setAttribute('data-theme',d?'dark':'light');r.style.colorScheme=cs;if(document.body){document.body.style.colorScheme=cs;}var tc=d?'#0e0e11':'#ffffff';var tms=document.querySelectorAll('meta[name="theme-color"]');if(tms.length){for(var i=0;i<tms.length;i++){tms[i].setAttribute('content',tc);tms[i].removeAttribute('media');}}else{var tm=document.createElement('meta');tm.name='theme-color';tm.content=tc;document.head.appendChild(tm);}var cms=document.querySelectorAll('meta[name="color-scheme"]');if(cms.length){for(var j=0;j<cms.length;j++){cms[j].setAttribute('content',cs);cms[j].removeAttribute('media');}}else{var cm=document.createElement('meta');cm.name='color-scheme';cm.content=cs;document.head.appendChild(cm);}}catch(e){}})();`;

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
