'use client';
// apps/erp/src/app/reports/page.tsx
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { api, formatINR } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

interface SalesSummary { date: string; revenue: number; cash: number; credit: number; count: number }
interface TopProduct { product: { name: string; sku: string }; quantitySold: number; revenuePaise: number }

export default function ReportsPage() {
  const [summary, setSummary] = useState<SalesSummary[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  let user: any = null;
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('indus_user') : null;
    if (s) user = JSON.parse(s);
  } catch {}
  const shopId = user?.role !== 'ADMIN' ? user?.shop?.id : undefined;

  async function load() {
    setLoading(true);
    try {
      const qs = `?days=${days}${shopId ? `&shopId=${shopId}` : ''}`;
      const [s, p] = await Promise.all([
        api.get<{ data: SalesSummary[] }>(`/api/reports/sales-summary${qs}`),
        api.get<{ data: TopProduct[] }>(`/api/reports/top-products${qs}&limit=10`),
      ]);
      setSummary(s.data);
      setTopProducts(p.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [days]);

  const totalRevenue = summary.reduce((s, d) => s + d.revenue, 0);
  const totalSales = summary.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-700 uppercase text-gray-900 text-2xl">Reports</h1>
            <p className="text-sm text-gray-500">Sales analytics and trends</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="form-input w-auto"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="erp-card border-l-4 border-orange-500">
            <div className="text-xs font-display font-600 uppercase text-gray-500 mb-1">Total Revenue</div>
            <div className="font-display font-700 text-2xl">{formatINR(totalRevenue)}</div>
            <div className="text-xs text-gray-400">{totalSales} confirmed sales</div>
          </div>
          <div className="erp-card border-l-4 border-blue-400">
            <div className="text-xs font-display font-600 uppercase text-gray-500 mb-1">Avg per Day</div>
            <div className="font-display font-700 text-2xl">
              {summary.length > 0 ? formatINR(Math.round(totalRevenue / summary.length)) : '₹0'}
            </div>
            <div className="text-xs text-gray-400">Over {days} days</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily sales table */}
          <div className="erp-card overflow-hidden p-0">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-display font-700 uppercase text-gray-900 text-sm">Daily Revenue</h2>
            </div>
            <div className="overflow-auto max-h-96">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th">Date</th>
                    <th className="table-th">Sales</th>
                    <th className="table-th">Revenue</th>
                    <th className="table-th">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={4} className="table-td text-center py-6 text-gray-400">Loading...</td></tr>}
                  {!loading && summary.length === 0 && <tr><td colSpan={4} className="table-td text-center py-6 text-gray-400">No data</td></tr>}
                  {[...summary].reverse().map((d) => (
                    <tr key={d.date} className="hover:bg-gray-50">
                      <td className="table-td font-mono text-xs">{d.date}</td>
                      <td className="table-td">{d.count}</td>
                      <td className="table-td font-display font-600">{formatINR(d.revenue)}</td>
                      <td className="table-td">
                        {d.credit > 0 ? <span className="text-red-500">{formatINR(d.credit)}</span> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top products */}
          <div className="erp-card overflow-hidden p-0">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-display font-700 uppercase text-gray-900 text-sm">Top Products</h2>
            </div>
            <div className="overflow-auto max-h-96">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-th">#</th>
                    <th className="table-th">Product</th>
                    <th className="table-th">Qty</th>
                    <th className="table-th">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={4} className="table-td text-center py-6 text-gray-400">Loading...</td></tr>}
                  {topProducts.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="table-td text-gray-400">{i + 1}</td>
                      <td className="table-td">
                        <div className="font-500">{p.product?.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.product?.sku}</div>
                      </td>
                      <td className="table-td">{p.quantitySold}</td>
                      <td className="table-td font-display font-600">{formatINR(p.revenuePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
