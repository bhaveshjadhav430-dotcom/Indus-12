// apps/web/src/app/page.tsx
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { ArrowRight, Shield, Truck, Package, Phone, ChevronRight } from 'lucide-react';

const categories = [
  { name: 'Pipes & Fittings', desc: 'UPVC, GI, CPVC, PVC — all sizes', icon: '⬡', color: 'bg-orange-50 border-orange-200' },
  { name: 'Electrical', desc: 'Wires, MCBs, conduits, switchgear', icon: '⚡', color: 'bg-yellow-50 border-yellow-200' },
  { name: 'Cement & Blocks', desc: 'OPC, PPC, fly ash, AAC blocks', icon: '◼', color: 'bg-gray-50 border-gray-200' },
  { name: 'Hardware & Fasteners', desc: 'Bolts, anchors, screws, channels', icon: '⚙', color: 'bg-slate-50 border-slate-200' },
  { name: 'Tools', desc: 'Power tools, hand tools, measuring', icon: '🔧', color: 'bg-red-50 border-red-200' },
  { name: 'Paints & Waterproofing', desc: 'Interior, exterior, primers, sealants', icon: '🖌', color: 'bg-blue-50 border-blue-200' },
];

const trustPoints = [
  { icon: Shield, title: 'Genuine Brands', desc: 'All products sourced directly from authorised distributors. No counterfeits.' },
  { icon: Truck, title: 'Site Delivery', desc: 'Bulk orders delivered to your construction site across Ludhiana.' },
  { icon: Package, title: 'Stock Guarantee', desc: 'Deep inventory across 2 branches — we rarely say "out of stock".' },
  { icon: Phone, title: 'Expert Advice', desc: 'Our staff has 20+ years experience helping contractors get it right.' },
];

export default function HomePage() {
  return (
    <>
      <Navbar />

      {/* ─── Hero ──────────────────────────────────────────────── */}
      <section className="relative bg-indus-charcoal hero-clip overflow-hidden pb-24 grit">
        {/* Orange accent stripe */}
        <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-indus-orange/10 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-indus-orange/5 rounded-full -translate-x-1/2 translate-y-1/2 pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-8">
          <div className="max-w-3xl">
            {/* Tag */}
            <div className="inline-flex items-center gap-2 bg-indus-orange/20 border border-indus-orange/30 px-4 py-1.5 mb-6">
              <span className="w-2 h-2 bg-indus-orange rounded-full" />
              <span className="font-display font-600 uppercase text-indus-orange text-xs tracking-widest">
                Ludhiana's Trusted Hardware Supplier
              </span>
            </div>

            <h1 className="font-display font-800 uppercase text-white leading-[0.9] text-6xl sm:text-7xl lg:text-8xl mb-6">
              Build it<br />
              <span className="text-indus-orange">right.</span>
            </h1>

            <p className="font-body text-gray-300 text-lg leading-relaxed max-w-xl mb-10">
              From foundation to finish — pipes, electrical, cement, hardware, tools and paints.
              Two branches, deep stock, on-time delivery.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/products" className="btn-primary">
                Browse Products <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="btn-outline border-gray-500 text-gray-300 hover:border-indus-orange hover:text-indus-orange hover:bg-transparent">
                Get a Quote
              </Link>
            </div>

            {/* Stats row */}
            <div className="mt-14 grid grid-cols-3 gap-6 max-w-lg">
              {[['20+', 'Years'], ['2', 'Branches'], ['5000+', 'Products']].map(([n, l]) => (
                <div key={l}>
                  <div className="font-display font-800 text-indus-orange text-4xl leading-none">{n}</div>
                  <div className="font-display font-500 uppercase text-gray-400 text-xs tracking-widest mt-1">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Categories ────────────────────────────────────────── */}
      <section className="bg-indus-grey-light py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12">
            <div className="accent-bar" />
            <h2 className="section-heading">What We Stock</h2>
            <p className="text-indus-grey-mid mt-3 max-w-xl">
              Everything a contractor, builder, or homeowner needs — under one roof.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {categories.map((cat) => (
              <Link
                key={cat.name}
                href="/products"
                className={`group flex items-start gap-4 p-6 bg-white border ${cat.color} hover:border-indus-orange hover:shadow-md transition-all duration-200`}
              >
                <span className="text-3xl leading-none mt-0.5">{cat.icon}</span>
                <div className="flex-1">
                  <h3 className="font-display font-700 uppercase text-indus-charcoal group-hover:text-indus-orange transition-colors text-lg leading-tight">
                    {cat.name}
                  </h3>
                  <p className="text-sm text-indus-grey-mid mt-1">{cat.desc}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-indus-orange mt-1 shrink-0 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Trust Signals ─────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12">
            <div className="accent-bar" />
            <h2 className="section-heading">Why Indus?</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {trustPoints.map((tp) => (
              <div key={tp.title} className="flex flex-col gap-3">
                <div className="w-12 h-12 bg-indus-orange flex items-center justify-center">
                  <tp.icon size={22} className="text-white" />
                </div>
                <h3 className="font-display font-700 uppercase text-indus-charcoal text-lg leading-tight">
                  {tp.title}
                </h3>
                <p className="text-sm text-indus-grey-mid leading-relaxed">{tp.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA Banner ────────────────────────────────────────── */}
      <section className="bg-indus-orange py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="font-display font-800 uppercase text-white text-4xl leading-none">
              Need bulk pricing?
            </h2>
            <p className="text-orange-100 mt-2">Call us or walk in. We give contractor rates on site.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="tel:+919876543210"
              className="inline-flex items-center gap-2 bg-white text-indus-orange font-display font-700 uppercase tracking-wide px-6 py-3 hover:bg-orange-50 transition-colors"
            >
              <Phone size={16} /> Call Now
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 border-2 border-white text-white font-display font-600 uppercase tracking-wide px-6 py-3 hover:bg-white hover:text-indus-orange transition-colors"
            >
              Get Quote
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Branches ──────────────────────────────────────────── */}
      <section className="bg-indus-grey-light py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <div className="accent-bar" />
            <h2 className="section-heading">Our Locations</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { name: 'Main Branch', address: '12, Industrial Area, Phase 2, Ludhiana, Punjab 141003', phone: '+91 98765 43210', hours: 'Mon–Sat 8AM–7PM · Sun 9AM–2PM' },
              { name: 'Branch 2', address: '45, Civil Lines, Ludhiana, Punjab 141001', phone: '+91 98765 43211', hours: 'Mon–Sat 8AM–7PM · Sun Closed' },
            ].map((b) => (
              <div key={b.name} className="bg-white p-6 border-l-4 border-indus-orange">
                <h3 className="font-display font-700 uppercase text-indus-charcoal text-xl mb-3">{b.name}</h3>
                <p className="text-sm text-indus-grey-mid mb-2">{b.address}</p>
                <a href={`tel:${b.phone.replace(/\s/g, '')}`} className="text-indus-orange font-display font-600 text-sm block mb-1">
                  {b.phone}
                </a>
                <p className="text-xs text-gray-400">{b.hours}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
