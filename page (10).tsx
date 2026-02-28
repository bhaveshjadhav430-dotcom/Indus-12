// apps/web/src/app/products/page.tsx
import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Phone } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Products',
  description: 'Browse our complete range of hardware, pipes, electrical, cement, tools, and construction materials in Ludhiana.',
};

const categories = [
  {
    name: 'Pipes & Fittings',
    items: ['UPVC Pressure Pipes (all sizes)', 'GI Pipes (25mm–100mm)', 'CPVC Hot Water Pipes', 'PVC SWR Pipes', 'UPVC/GI Fittings (elbows, tees, couplers)', 'Ball Valves & Gate Valves'],
    brands: ['Ashirvad', 'Supreme', 'Finolex', 'Prince'],
  },
  {
    name: 'Electrical',
    items: ['FR PVC Copper Wire (1–16 sq.mm)', 'MCBs & MCCBs', 'PVC Conduit Pipes & Accessories', 'Distribution Boards', 'LED Panels & Battens', 'Switches & Sockets'],
    brands: ['Polycab', 'Havells', 'Legrand', 'Anchor'],
  },
  {
    name: 'Cement & Construction',
    items: ['OPC 53 Grade Cement', 'PPC Cement', 'Fly Ash Bricks', 'AAC / Solid Blocks', 'M-Sand & Stone Chips', 'Steel Binding Wire'],
    brands: ['ACC', 'Ultratech', 'Ambuja', 'JK'],
  },
  {
    name: 'Hardware & Fasteners',
    items: ['Hex Bolts & Nuts (M6–M30)', 'Self-Drilling Screws', 'Anchor Bolts (chemical & mechanical)', 'MS Channels & Angles', 'Door Handles & Hinges', 'Padlocks & Safety Locks'],
    brands: ['Hilti', 'Bosch', 'Unbrako', 'GKW'],
  },
  {
    name: 'Tools',
    items: ['Rotary Hammer Drills', 'Angle Grinders', 'Measuring Tapes & Levels', 'Hand Tools (hammers, chisels)', 'Concrete Vibrators', 'Scaffolding Clamps'],
    brands: ['Bosch', 'Makita', 'Stanley', 'Taparia'],
  },
  {
    name: 'Paints & Waterproofing',
    items: ['Exterior Acrylic Emulsion', 'Interior Emulsion', 'Wall Putty & Primer', 'Waterproofing Coatings', 'Epoxy Flooring Paint', 'Bitumen / Tar Sheets'],
    brands: ['Asian Paints', 'Berger', 'Dr. Fixit', 'Sika'],
  },
];

export default function ProductsPage() {
  return (
    <>
      <Navbar />

      {/* Header */}
      <section className="bg-indus-charcoal py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-12 h-1 bg-indus-orange mb-4" />
          <h1 className="font-display font-800 uppercase text-white text-5xl sm:text-6xl leading-none">
            Our Products
          </h1>
          <p className="text-gray-300 mt-4 max-w-xl">
            5000+ SKUs across 6 categories. Call us for pricing — we give contractor rates on bulk orders.
          </p>
        </div>
      </section>

      {/* Categories grid */}
      <section className="bg-indus-grey-light py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {categories.map((cat) => (
              <div key={cat.name} className="bg-white border border-gray-100 overflow-hidden">
                <div className="bg-indus-charcoal px-6 py-4 border-l-4 border-indus-orange">
                  <h2 className="font-display font-700 uppercase text-white text-xl">{cat.name}</h2>
                </div>
                <div className="px-6 py-5">
                  <ul className="space-y-2">
                    {cat.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-indus-grey">
                        <span className="text-indus-orange mt-0.5 shrink-0">—</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <span className="text-xs text-gray-400 uppercase tracking-widest font-display font-600">Brands: </span>
                    <span className="text-xs text-indus-grey-mid">{cat.brands.join(' · ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Price CTA */}
      <section className="bg-indus-orange py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-display font-800 uppercase text-white text-3xl mb-3">
            Need pricing or availability?
          </h2>
          <p className="text-orange-100 mb-6">We'll give you an instant quote over the phone.</p>
          <a
            href="tel:+919876543210"
            className="inline-flex items-center gap-2 bg-white text-indus-orange font-display font-700 uppercase px-8 py-3 hover:bg-orange-50 transition-colors"
          >
            <Phone size={16} /> +91 98765 43210
          </a>
        </div>
      </section>

      <Footer />
    </>
  );
}
