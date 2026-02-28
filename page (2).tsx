'use client';
// apps/erp/src/app/dashboard/page.tsx
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { api, formatINR } from '@/lib/api';
import { TrendingUp, ShoppingCart, AlertTriangle, CreditCard, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface Dashboard {
  period: { from: string; to: string };
  sales: { count: number; totalRevenuePaise: number; totalCashPaise: number; totalCreditPaise: number };
  creditOutstandingPaise: number;
  lowStockItems: number;
  recentSales: any[];
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  let user: any = null;
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('indus_user') : null;
    if (stored) user = JSON.parse(stored);
  } catch {}

  async function load() {
    setLoading(true);
    setError('');
    try {
      const shopId = user?.role !== 'ADMIN' ? user?.shop?.id : undefined;
      const qs = shopId ? `?shopId=${shopId}` : '';
      const d = await api.get<Dashboard>(`/api/reports/dashboard${qs}`);
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-700 uppercase text-gray-900 text-2xl">Dashboard</h1>
            <p className="text-sm text-gray-500">Today's overview</p>
          </div>
          <button onClick={load} className="btn-secondary">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm mb-4">{error}</div>}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="erp-card h-28 animate-pulse bg-gray-100" />
            ))}
          </div>
        ) : data ? (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="erp-card border-l-4 border-orange-500">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-display font-600 uppercase tracking-wider text-gray-500">Today Revenue</span>
                  <TrendingUp size={16} className="text-orange-500" />
                </div>
                <div className="font-display font-700 text-2xl text-gray-900">{formatINR(data.sales.totalRevenuePaise)}</div>
                <div className="text-xs text-gray-400 mt-1">{data.sales.count} confirmed sales</div>
              </div>

              <div className="erp-card border-l-4 border-green-500">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-display font-600 uppercase tracking-wider text-gray-500">Cash Collected</span>
                  <ShoppingCart size={16} className="text-green-500" />
                </div>
                <div className="font-display font-700 text-2xl text-gray-900">{formatINR(data.sales.totalCashPaise)}</div>
                <div className="text-xs text-gray-400 mt-1">Credit: {formatINR(data.sales.totalCreditPaise)}</div>
              </div>

              <div className="erp-card border-l-4 border-red-500">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-display font-600 uppercase tracking-wider text-gray-500">Credit Outstanding</span>
                  <CreditCard size={16} className="text-red-500" />
                </div>
                <div className="font-display font-700 text-2xl text-gray-900">{formatINR(data.creditOutstandingPaise)}</div>
                <div className="text-xs text-gray-400 mt-1">Across all customers</div>
              </div>

              <div className={`erp-card border-l-4 ${data.lowStockItems > 0 ? 'border-yellow-500' : 'border-gray-300'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-display font-600 uppercase tracking-wider text-gray-500">Low Stock</span>
                  <AlertTriangle size={16} className={data.lowStockItems > 0 ? 'text-yellow-500' : 'text-gray-300'} />
                </div>
                <div className="font-display font-700 text-2xl text-gray-900">{data.lowStockItems}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {data.lowStockItems > 0 ? (
                    <Link href="/inventory" className="text-orange-600 hover:underline">View items →</Link>
                  ) : 'All stock levels OK'}
                </div>
              </div>
            </div>

            {/* Recent sales */}
            <div className="erp-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-700 uppercase text-gray-900">Recent Sales</h2>
                <Link href="/sales" className="text-xs text-orange-600 hover:underline font-display font-600 uppercase">View All</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-th">Invoice</th>
                      <th className="table-th">Customer</th>
                      <th className="table-th">Amount</th>
                      <th className="table-th">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSales.length === 0 && (
                      <tr>
                        <td colSpan={4} className="table-td text-center text-gray-400 py-8">No sales today yet</td>
                      </tr>
                    )}
                    {data.recentSales.map((s) => (
                      <tr key={s.id}>
                        <td className="table-td">
                          <Link href={`/sales/${s.id}`} className="text-orange-600 hover:underline font-display font-600">
                            {s.invoiceNumber}
                          </Link>
                        </td>
                        <td className="table-td">{s.customer?.name || '—'}</td>
                        <td className="table-td font-display font-600">{formatINR(s.totalAmountPaise)}</td>
                        <td className="table-td text-gray-400">
                          {s.confirmedAt ? new Date(s.confirmedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
