// apps/web/src/components/Footer.tsx
import Link from 'next/link';
import { Phone, MapPin, Mail, Clock } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-indus-charcoal text-gray-300">
      <div className="border-t-4 border-indus-orange" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indus-orange flex items-center justify-center">
                <span className="font-display font-800 text-white text-xl">I</span>
              </div>
              <div>
                <div className="font-display font-700 uppercase text-white text-lg leading-none">Indus</div>
                <div className="text-xs text-gray-400 uppercase tracking-widest">Hardware & Materials</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-gray-400">
              Trusted supplier of quality hardware, pipes, electrical, and construction materials since 2005.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="font-display font-700 uppercase text-white text-sm tracking-widest mb-4">Quick Links</h4>
            <ul className="space-y-2">
              {[['/', 'Home'], ['/products', 'Products'], ['/about', 'About Us'], ['/contact', 'Contact']].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-gray-400 hover:text-indus-orange transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Products */}
          <div>
            <h4 className="font-display font-700 uppercase text-white text-sm tracking-widest mb-4">Categories</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              {['Pipes & Fittings', 'Electrical', 'Cement & Construction', 'Hardware & Fasteners', 'Tools', 'Paints'].map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-display font-700 uppercase text-white text-sm tracking-widest mb-4">Contact Us</h4>
            <ul className="space-y-3 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 text-indus-orange shrink-0" />
                <span>12, Industrial Area, Phase 2, Ludhiana, Punjab 141003</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone size={14} className="text-indus-orange" />
                <a href="tel:+919876543210" className="hover:text-indus-orange">+91 98765 43210</a>
              </li>
              <li className="flex items-center gap-2">
                <Mail size={14} className="text-indus-orange" />
                <a href="mailto:info@indusmaterials.com" className="hover:text-indus-orange">info@indusmaterials.com</a>
              </li>
              <li className="flex items-start gap-2">
                <Clock size={14} className="mt-0.5 text-indus-orange" />
                <span>Mon–Sat: 8:00 AM – 7:00 PM<br />Sun: 9:00 AM – 2:00 PM</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} Indus Hardware & Materials. All rights reserved.
          </p>
          <p className="text-xs text-gray-600">GSTIN: 03AABCI1234A1ZX</p>
        </div>
      </div>
    </footer>
  );
}
