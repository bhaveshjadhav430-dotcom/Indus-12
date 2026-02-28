'use client';
// apps/erp/src/app/sales/page.tsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sidebar } from '@/components/Sidebar';
import { api, formatINR, genIdempotencyKey } from '@/lib/api';
import { Plus, Search, RefreshCw, X, CheckCircle } from 'lucide-react';

interface Sale {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmountPaise: number;
  creditAmountPaise: number;
  confirmedAt: string | null;
  customer: { name: string; phone: string } | null;
  createdBy: { name: string };
  _count: { items: number };
}

interface StockItem {
  id: string;
  product: { id: string; name: string; sku: string; unit: string };
  quantityOnHand: number;
  salePricePaise: number;
}

interface Customer { id: string; name: string; phone: string; creditLimitPaise: number }

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSale, setShowNewSale] = useState(false);
  const [search, setSearch] = useState('');

  let user: any = null;
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem('indus_user') : null;
    if (s) user = JSON.parse(s);
  } catch {}

  const shopId = user?.shop?.id || '';

  async function loadSales() {
    setLoading(true);
    try {
      const res = await api.get<{ data: Sale[] }>(`/api/sales?shopId=${shopId}&limit=50`);
      setSales(res.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadSales(); }, []);

  const filtered = sales.filter((s) =>
    s.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
    (s.customer?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-700 uppercase text-gray-900 text-2xl">Sales</h1>
            <p className="text-sm text-gray-500">Manage invoices and transactions</p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadSales} className="btn-secondary"><RefreshCw size={14} /></button>
            <button onClick={() => setShowNewSale(true)} className="btn-primary">
              <Plus size={14} /> New Sale
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search invoice or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-9"
          />
        </div>

        {/* Table */}
        <div className="erp-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Invoice</th>
                  <th className="table-th">Customer</th>
                  <th className="table-th">Items</th>
                  <th className="table-th">Total</th>
                  <th className="table-th">Credit</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Date</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="table-td text-center py-10 text-gray-400">Loading...</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="table-td text-center py-10 text-gray-400">No sales found</td></tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="table-td">
                      <Link href={`/sales/${s.id}`} className="text-orange-600 hover:underline font-display font-600">
                        {s.invoiceNumber}
                      </Link>
                    </td>
                    <td className="table-td">{s.customer?.name || <span className="text-gray-400">Walk-in</span>}</td>
                    <td className="table-td">{s._count.items}</td>
                    <td className="table-td font-display font-600">{formatINR(s.totalAmountPaise)}</td>
                    <td className="table-td">
                      {s.creditAmountPaise > 0 ? (
                        <span className="text-red-600 font-display font-600">{formatINR(s.creditAmountPaise)}</span>
                      ) : '—'}
                    </td>
                    <td className="table-td">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded font-display font-600 uppercase ${
                        s.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' :
                        s.status === 'VOIDED' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="table-td text-gray-400">
                      {s.confirmedAt ? new Date(s.confirmedAt).toLocaleDateString('en-IN') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* New Sale Modal */}
        {showNewSale && (
          <NewSaleModal
            shopId={shopId}
            userId={user?.id}
            onClose={() => setShowNewSale(false)}
            onSuccess={() => { setShowNewSale(false); loadSales(); }}
          />
        )}
      </main>
    </div>
  );
}

// ─── New Sale Modal ────────────────────────────────────────────
function NewSaleModal({ shopId, userId, onClose, onSuccess }: {
  shopId: string; userId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [items, setItems] = useState<{ productId: string; quantity: number; unitPricePaise: number; name: string }[]>([]);
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CREDIT'>('CASH');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get<{ data: StockItem[] }>(`/api/inventory/stock?shopId=${shopId}`).then((r) => setStock(r.data)).catch(() => {});
    api.get<{ data: Customer[] }>('/api/customers').then((r) => setCustomers(r.data)).catch(() => {});
  }, [shopId]);

  const total = items.reduce((s, i) => s + i.quantity * i.unitPricePaise, 0);

  function addItem(e: React.ChangeEvent<HTMLSelectElement>) {
    const sl = stock.find((s) => s.id === e.target.value);
    if (!sl) return;
    setItems((prev) => [...prev, { productId: sl.product.id, quantity: 1, unitPricePaise: sl.salePricePaise, name: sl.product.name }]);
    e.target.value = '';
  }

  function updateItem(idx: number, field: string, value: any) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) { setError('Add at least one item'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.post<{ sale: any }>('/api/sales', {
        shopId,
        customerId: customerId || undefined,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPricePaise: i.unitPricePaise })),
        payments: [{ mode: paymentMode, amountPaise: total }],
        notes,
      }, genIdempotencyKey());
      setSuccess(res.sale.invoiceNumber);
      setTimeout(onSuccess, 1500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end">
      <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="font-display font-700 uppercase text-gray-900">New Sale</h2>
          <button onClick={onClose} className="p-1 hover:text-red-500"><X size={18} /></button>
        </div>

        {success ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <CheckCircle size={48} className="text-green-500" />
            <div className="font-display font-700 text-xl text-gray-900">Sale Confirmed!</div>
            <div className="text-gray-500">{success}</div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6 space-y-5">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}

            {/* Customer */}
            <div>
              <label className="form-label">Customer (Optional)</label>
              <select className="form-input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in Customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            </div>

            {/* Add Items */}
            <div>
              <label className="form-label">Add Product</label>
              <select className="form-input" onChange={addItem} defaultValue="">
                <option value="" disabled>— Select product —</option>
                {stock.filter((s) => s.quantityOnHand > 0).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.product.name} — Stock: {s.quantityOnHand} {s.product.unit} — {formatINR(s.salePricePaise)}
                  </option>
                ))}
              </select>
            </div>

            {/* Items list */}
            {items.length > 0 && (
              <div className="border border-gray-200 rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left text-xs font-display font-600 uppercase text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left text-xs font-display font-600 uppercase text-gray-500">Qty</th>
                      <th className="px-3 py-2 text-left text-xs font-display font-600 uppercase text-gray-500">Price</th>
                      <th className="px-3 py-2 text-left text-xs font-display font-600 uppercase text-gray-500">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-700">{item.name}</td>
                        <td className="px-3 py-2">
                          <input type="number" min={1} value={item.quantity}
                            onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-16 border border-gray-200 rounded px-2 py-1 text-xs" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min={1} value={item.unitPricePaise / 100}
                            onChange={(e) => updateItem(idx, 'unitPricePaise', Math.round(parseFloat(e.target.value) * 100) || 0)}
                            className="w-24 border border-gray-200 rounded px-2 py-1 text-xs" />
                        </td>
                        <td className="px-3 py-2 text-gray-700 font-display font-600">
                          {formatINR(item.quantity * item.unitPricePaise)}
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-orange-50 border-t-2 border-orange-200">
                      <td colSpan={3} className="px-3 py-2 text-right font-display font-700 uppercase text-sm">Total</td>
                      <td colSpan={2} className="px-3 py-2 font-display font-700 text-orange-700 text-base">{formatINR(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Payment */}
            <div>
              <label className="form-label">Payment Mode</label>
              <select className="form-input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as any)}>
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CREDIT">Credit (Customer Account)</option>
              </select>
              {paymentMode === 'CREDIT' && !customerId && (
                <p className="text-xs text-red-500 mt-1">⚠ Select a customer for credit sales</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="form-label">Notes (optional)</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="form-input" placeholder="Site name, PO number, etc." />
            </div>

            <button type="submit" disabled={loading || items.length === 0} className="w-full btn-primary justify-center py-3">
              {loading ? 'Confirming...' : `Confirm Sale — ${formatINR(total)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
