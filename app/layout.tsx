import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// خط ثمانية سانس — مضمَّن في البناء (لا يُوضع في public/ — راجع lib/fonts.ts)
const thmanyah = localFont({
  src: [
    { path: './fonts/thmanyah-sans/thmanyahsans-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/thmanyah-sans/thmanyahsans-Medium.woff2',  weight: '500', style: 'normal' },
    { path: './fonts/thmanyah-sans/thmanyahsans-Bold.woff2',    weight: '700', style: 'normal' },
    { path: './fonts/thmanyah-sans/thmanyahsans-Black.woff2',   weight: '900', style: 'normal' },
  ],
  variable: '--font-thmanyah',
  display: 'swap',
  fallback: ['Tahoma', 'Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'مركز خطوة أمل',
  description: 'مركز خطوة أمل — نظام إدارة وجبات المستفيدين ذوي القيود الغذائية',
  applicationName: 'مركز خطوة أمل',
  appleWebApp: {
    capable: true,
    title: 'مركز خطوة أمل',
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
    <html lang="ar" dir="rtl" className={thmanyah.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
