'use client';
// apps/erp/src/app/inventory/page.tsx
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { api, formatINR } from '@/lib/api';
import { Search, AlertTriangle, Package, RefreshCw } from 'lucide-react';

interface StockItem {
  id: string;
  quantityOnHand: number;
  salePricePaise: number;
  costPricePaise: number;
  reorderLevel: number;
  isLowStock: boolean;
  product: { id: string; name: string; sku: string; unit: string; category: { name: string } };
}

export default function InventoryPage() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  let user: any = null;
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('indus_user') : null;
    if (s) user = JSON.parse(s);
  } catch {}
  const shopId = user?.shop?.id || '';
  const isAdmin = user?.role === 'ADMIN';

  async function load() {
    setLoading(true);
    try {
      const qs = shopId ? `?shopId=${shopId}` : '';
      const res = await api.get<{ data: StockItem[] }>(`/api/inventory/stock${qs}`);
      setStock(res.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = stock.filter((s) => {
    const matchSearch = s.product.name.toLowerCase().includes(search.toLowerCase()) ||
      s.product.sku.toLowerCase().includes(search.toLowerCase());
    const matchLow = !lowStockOnly || s.isLowStock;
    return matchSearch && matchLow;
  });

  const lowCount = stock.filter((s) => s.isLowStock).length;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-700 uppercase text-gray-900 text-2xl">Inventory</h1>
            <p className="text-sm text-gray-500">{stock.length} products · {lowCount} low stock</p>
          </div>
          <div className="flex gap-3">
            <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search product or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-9"
            />
          </div>
          <button
            onClick={() => setLowStockOnly(!lowStockOnly)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-display font-600 uppercase rounded border transition-colors ${
              lowStockOnly ? 'bg-yellow-100 border-yellow-400 text-yellow-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <AlertTriangle size={14} /> Low Stock Only
            {lowCount > 0 && <span className="bg-yellow-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">{lowCount}</span>}
          </button>
        </div>

        <div className="erp-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Product</th>
                  <th className="table-th">SKU</th>
                  <th className="table-th">Category</th>
                  <th className="table-th">On Hand</th>
                  <th className="table-th">Reorder At</th>
                  <th className="table-th">Sale Price</th>
                  {isAdmin && <th className="table-th">Cost</th>}
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="table-td text-center py-10 text-gray-400">Loading...</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="table-td text-center py-10 text-gray-400">
                    <Package size={32} className="mx-auto mb-2 text-gray-300" />
                    No products found
                  </td></tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id} className={`hover:bg-gray-50 ${s.isLowStock ? 'bg-yellow-50' : ''}`}>
                    <td className="table-td font-500">{s.product.name}</td>
                    <td className="table-td text-gray-400 font-mono text-xs">{s.product.sku}</td>
                    <td className="table-td text-gray-500">{s.product.category.name}</td>
                    <td className="table-td">
                      <span className={`font-display font-700 ${s.isLowStock ? 'text-red-600' : 'text-gray-900'}`}>
                        {s.quantityOnHand} {s.product.unit}
                      </span>
                    </td>
                    <td className="table-td text-gray-500">{s.reorderLevel}</td>
                    <td className="table-td font-display font-600">{formatINR(s.salePricePaise)}</td>
                    {isAdmin && <td className="table-td text-gray-400">{formatINR(s.costPricePaise)}</td>}
                    <td className="table-td">
                      {s.isLowStock ? (
                        <span className="flex items-center gap-1 text-yellow-700 text-xs font-display font-600 uppercase">
                          <AlertTriangle size={12} /> Low
                        </span>
                      ) : (
                        <span className="text-green-600 text-xs font-display font-600 uppercase">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
