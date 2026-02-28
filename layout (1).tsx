// apps/web/src/app/layout.tsx
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
  title: {
    default: 'Indus Hardware & Materials | Ludhiana',
    template: '%s | Indus Hardware & Materials',
  },
  description:
    'Indus Hardware & Materials — your trusted supplier for pipes, electrical, cement, hardware, tools, and construction materials in Ludhiana, Punjab.',
  keywords: ['hardware store Ludhiana', 'building materials Ludhiana', 'pipes fittings Punjab', 'electrical supplies Ludhiana', 'cement supplier Ludhiana'],
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: 'Indus Hardware & Materials',
    title: 'Indus Hardware & Materials | Ludhiana',
    description: 'Trusted supplier of building materials, pipes, electrical, hardware & tools in Ludhiana.',
  },
  robots: { index: true, follow: true },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.indusmaterials.com'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlowCondensed.variable} ${barlow.variable}`}>
      <body className="font-body bg-white text-indus-grey antialiased">
        {children}
      </body>
    </html>
  );
}
