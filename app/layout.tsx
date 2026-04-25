import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'نظام إدارة الوجبات',
  description: 'نظام إدارة وجبات المطعم للمستفيدين ذوي القيود الغذائية',
  applicationName: 'إدارة الوجبات',
  appleWebApp: {
    capable: true,
    title: 'إدارة الوجبات',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#059669',
};

const themeInitScript = `
(function(){try{
  var t = localStorage.getItem('theme');
  if (t === 'dark') document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
