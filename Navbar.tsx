'use client';
// apps/web/src/components/Navbar.tsx
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X, Phone } from 'lucide-react';

const links = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-indus-charcoal border-b-2 border-indus-orange">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 bg-indus-orange flex items-center justify-center">
              <span className="font-display font-800 text-white text-lg leading-none">I</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-display font-700 uppercase text-white text-base tracking-wider">Indus</span>
              <span className="font-body text-indus-grey-light text-[10px] tracking-widest uppercase">Hardware & Materials</span>
            </div>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="font-display font-600 uppercase tracking-wider text-sm text-gray-300 hover:text-indus-orange transition-colors duration-150"
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-4">
            <a href="tel:+919876543210" className="flex items-center gap-2 text-indus-orange text-sm font-display font-600">
              <Phone size={14} />
              <span>+91 98765 43210</span>
            </a>
            <a href="/erp" className="btn-primary text-sm py-2 px-4">
              Staff Login
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden text-white p-2"
            aria-label="Toggle menu"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-indus-charcoal border-t border-gray-700">
          <div className="px-4 py-4 flex flex-col gap-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-display font-600 uppercase tracking-wider text-gray-300 hover:text-indus-orange"
              >
                {l.label}
              </Link>
            ))}
            <a href="tel:+919876543210" className="flex items-center gap-2 text-indus-orange font-display font-600">
              <Phone size={14} /> +91 98765 43210
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
