// apps/web/src/app/contact/page.tsx
import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Phone, MapPin, Mail, Clock } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Contact Indus Hardware & Materials. Visit our branches in Ludhiana or call us for pricing and bulk orders.',
};

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <section className="bg-indus-charcoal py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="w-12 h-1 bg-indus-orange mb-4" />
          <h1 className="font-display font-800 uppercase text-white text-5xl sm:text-6xl leading-none">Contact Us</h1>
          <p className="text-gray-300 mt-4">We're open 6 days a week. Call, email, or walk in.</p>
        </div>
      </section>

      <section className="bg-indus-grey-light py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

            {/* Contact info */}
            <div className="space-y-6">
              {[
                {
                  name: 'Main Branch',
                  address: '12, Industrial Area, Phase 2, Ludhiana, Punjab 141003',
                  phone: '+91 98765 43210',
                  email: 'main@indusmaterials.com',
                  hours: 'Mon–Sat: 8:00 AM – 7:00 PM\nSunday: 9:00 AM – 2:00 PM',
                },
                {
                  name: 'Branch 2 — Civil Lines',
                  address: '45, Civil Lines, Ludhiana, Punjab 141001',
                  phone: '+91 98765 43211',
                  email: 'branch2@indusmaterials.com',
                  hours: 'Mon–Sat: 8:00 AM – 7:00 PM\nSunday: Closed',
                },
              ].map((b) => (
                <div key={b.name} className="bg-white p-6 border-l-4 border-indus-orange">
                  <h2 className="font-display font-700 uppercase text-indus-charcoal text-xl mb-4">{b.name}</h2>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin size={15} className="text-indus-orange mt-0.5 shrink-0" />
                      <span className="text-sm text-indus-grey-mid">{b.address}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Phone size={15} className="text-indus-orange shrink-0" />
                      <a href={`tel:${b.phone}`} className="text-sm text-indus-grey hover:text-indus-orange">{b.phone}</a>
                    </div>
                    <div className="flex items-center gap-3">
                      <Mail size={15} className="text-indus-orange shrink-0" />
                      <a href={`mailto:${b.email}`} className="text-sm text-indus-grey hover:text-indus-orange">{b.email}</a>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock size={15} className="text-indus-orange mt-0.5 shrink-0" />
                      <span className="text-sm text-indus-grey-mid whitespace-pre-line">{b.hours}</span>
                    </div>
                  </div>
                </div>
              ))}

              <div className="bg-indus-orange text-white p-6">
                <h3 className="font-display font-700 uppercase text-xl mb-2">General Enquiries</h3>
                <div className="flex items-center gap-2 text-sm">
                  <Mail size={14} />
                  <a href="mailto:info@indusmaterials.com" className="hover:underline">info@indusmaterials.com</a>
                </div>
              </div>
            </div>

            {/* WhatsApp / Quick actions */}
            <div className="space-y-5">
              <div className="bg-white p-8 border border-gray-100">
                <h2 className="font-display font-700 uppercase text-indus-charcoal text-2xl mb-4">
                  Get a Quick Quote
                </h2>
                <p className="text-indus-grey-mid text-sm mb-6">
                  Call us or send a WhatsApp message with your material list. We'll send you a quote within 30 minutes during working hours.
                </p>
                <div className="flex flex-col gap-3">
                  <a
                    href="tel:+919876543210"
                    className="btn-primary justify-center"
                  >
                    <Phone size={16} /> Call Main Branch
                  </a>
                  <a
                    href="https://wa.me/919876543210?text=Hi%20Indus%20Hardware%2C%20I%20need%20a%20quote%20for%3A"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-green-600 text-white font-display font-700 uppercase tracking-wide px-6 py-3 hover:bg-green-700 transition-colors"
                  >
                    WhatsApp Quote Request
                  </a>
                </div>
              </div>

              <div className="bg-indus-charcoal p-6">
                <h3 className="font-display font-700 uppercase text-white mb-3">Staff / Trade Login</h3>
                <p className="text-gray-400 text-sm mb-4">Access the internal ERP for sales, inventory, and reports.</p>
                <a
                  href={`${process.env.NEXT_PUBLIC_ERP_URL || '/erp'}`}
                  className="btn-primary text-sm py-2 px-4"
                >
                  Go to Staff Portal →
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
