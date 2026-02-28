// apps/web/src/app/about/page.tsx
import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Learn about Indus Hardware & Materials — 20+ years serving contractors and builders in Ludhiana, Punjab.',
};

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <section className="bg-indus-charcoal py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-12 h-1 bg-indus-orange mb-4" />
          <h1 className="font-display font-800 uppercase text-white text-5xl sm:text-6xl leading-none">About Us</h1>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div>
            <div className="w-12 h-1 bg-indus-orange mb-4" />
            <h2 className="font-display font-700 uppercase text-indus-charcoal text-4xl leading-none mb-6">
              Built on trust.<br />Backed by stock.
            </h2>
            <div className="space-y-4 text-indus-grey-mid leading-relaxed">
              <p>
                Indus Hardware & Materials was established in 2005 in Ludhiana's Industrial Area with a single goal: give contractors and builders a reliable, honest supplier they can count on.
              </p>
              <p>
                Over two decades, we've grown to two full-stocked branches, a team of 40+ staff, and relationships with every major brand in the industry. We don't just sell hardware — we help projects get done right.
              </p>
              <p>
                Every product in our store is sourced directly from authorised distributors. We don't deal in substandard goods, because a water pipe that bursts or a wire that shorts can cost far more than the savings.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[['2005', 'Founded'], ['2', 'Branches'], ['40+', 'Staff'], ['5000+', 'SKUs'], ['₹50Cr+', 'Annual Sales'], ['95%', 'Repeat Customers']].map(([n, l]) => (
              <div key={l} className="bg-indus-grey-light p-6 border-l-4 border-indus-orange">
                <div className="font-display font-800 text-indus-orange text-4xl leading-none">{n}</div>
                <div className="font-display font-600 uppercase text-indus-charcoal text-xs tracking-widest mt-2">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
