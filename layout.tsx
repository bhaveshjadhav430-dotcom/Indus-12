// apps/erp/src/app/layout.tsx
import type { Metadata } from 'next';
import { Barlow_Condensed, Barlow } from 'next/font/google';
import './globals.css';

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Indus ERP — Staff Portal',
  description: 'Indus Hardware internal management system',
  robots: { index: false, follow: false },
};

export default function ERPLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlowCondensed.variable} ${barlow.variable}`}>
      <body className="font-body bg-gray-50 text-gray-800 antialiased">
        {children}
      </body>
    </html>
  );
}
