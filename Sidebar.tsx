'use client';
// apps/erp/src/components/Sidebar.tsx
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ShoppingCart, Package, Users, BarChart2, Settings, LogOut, Store } from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', adminOnly: false },
  { href: '/sales', icon: ShoppingCart, label: 'Sales', adminOnly: false },
  { href: '/inventory', icon: Package, label: 'Inventory', adminOnly: false },
  { href: '/customers', icon: Users, label: 'Customers', adminOnly: false },
  { href: '/reports', icon: BarChart2, label: 'Reports', adminOnly: false },
  { href: '/shops', icon: Store, label: 'Shops', adminOnly: true },
  { href: '/settings', icon: Settings, label: 'Settings', adminOnly: false },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  let user: any = null;
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('indus_user') : null;
    if (stored) user = JSON.parse(stored);
  } catch {}

  const isAdmin = user?.role === 'ADMIN';

  function logout() {
    localStorage.removeItem('indus_token');
    localStorage.removeItem('indus_user');
    router.push('/login');
  }

  const visibleNav = navItems.filter((n) => !n.adminOnly || isAdmin);

  return (
    <aside className="flex flex-col w-56 bg-gray-900 min-h-screen shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-700">
        <div className="w-8 h-8 bg-orange-600 flex items-center justify-center shrink-0">
          <span className="font-display font-800 text-white">I</span>
        </div>
        <div>
          <div className="font-display font-700 uppercase text-white text-sm leading-none">Indus ERP</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">
            {isAdmin ? 'Admin' : 'Shop Manager'}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2">
        {visibleNav.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm mb-0.5 transition-colors ${
                active
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon size={16} />
              <span className="font-display font-600 uppercase tracking-wide text-xs">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-gray-700 p-4">
        {user && (
          <div className="mb-3">
            <div className="text-xs font-display font-600 text-white uppercase truncate">{user.name}</div>
            <div className="text-[10px] text-gray-400 truncate">{user.email}</div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-2 text-gray-400 hover:text-red-400 text-xs font-display font-600 uppercase tracking-wide transition-colors"
        >
          <LogOut size={13} /> Sign Out
        </button>
      </div>
    </aside>
  );
}
