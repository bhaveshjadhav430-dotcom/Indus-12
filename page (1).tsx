'use client';
// apps/erp/src/app/customers/page.tsx
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { api, formatINR } from '@/lib/api';
import { Search, Plus, RefreshCw, X, CheckCircle } from 'lucide-react';

interface Customer {
  id: string; name: string; phone: string; address: string | null;
  creditLimitPaise: number; outstandingCreditPaise: number;
  _count: { sales: number };
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);

  async function load() {
    setLoading(true);
    try {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await api.get<{ data: Customer[] }>(`/api/customers${qs}`);
      setCustomers(res.data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display font-700 uppercase text-gray-900 text-2xl">Customers</h1>
            <p className="text-sm text-gray-500">Manage credit accounts and history</p>
          </div>
          <div className="flex gap-3">
            <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
            <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={14} /> Add Customer</button>
          </div>
        </div>

        <div className="flex gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Search name or phone..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              className="form-input pl-9"
            />
          </div>
          <button onClick={load} className="btn-secondary">Search</button>
        </div>

        <div className="erp-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Phone</th>
                  <th className="table-th">Sales</th>
                  <th className="table-th">Credit Limit</th>
                  <th className="table-th">Outstanding</th>
                  <th className="table-th">Available</th>
                  <th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="table-td text-center py-10 text-gray-400">Loading...</td></tr>}
                {!loading && customers.length === 0 && <tr><td colSpan={7} className="table-td text-center py-10 text-gray-400">No customers found</td></tr>}
                {customers.map((c) => {
                  const available = c.creditLimitPaise - c.outstandingCreditPaise;
                  const overLimit = available < 0;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="table-td font-500">{c.name}</td>
                      <td className="table-td text-gray-500">{c.phone}</td>
                      <td className="table-td">{c._count.sales}</td>
                      <td className="table-td">{formatINR(c.creditLimitPaise)}</td>
                      <td className="table-td">
                        {c.outstandingCreditPaise > 0 ? (
                          <span className="text-red-600 font-display font-600">{formatINR(c.outstandingCreditPaise)}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-td">
                        <span className={overLimit ? 'text-red-600 font-display font-700' : 'text-green-600'}>
                          {formatINR(available)}
                        </span>
                      </td>
                      <td className="table-td">
                        <button onClick={() => setSelected(c)} className="text-xs text-orange-600 hover:underline font-display font-600 uppercase">
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {showNew && (
          <NewCustomerModal
            onClose={() => setShowNew(false)}
            onSuccess={() => { setShowNew(false); load(); }}
          />
        )}

        {selected && (
          <CustomerDetailModal
            customer={selected}
            onClose={() => setSelected(null)}
            onSuccess={() => { setSelected(null); load(); }}
          />
        )}
      </main>
    </div>
  );
}

function NewCustomerModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', address: '', creditLimitPaise: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      await api.post('/api/customers', { ...form, creditLimitPaise: Math.round(form.creditLimitPaise * 100) });
      onSuccess();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-700 uppercase text-gray-900">New Customer</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {error && <div className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 p-3 rounded">{error}</div>}
        <form onSubmit={submit} className="space-y-4">
          <div><label className="form-label">Full Name</label><input required className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="form-label">Phone</label><input required className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="form-label">Address</label><input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><label className="form-label">Credit Limit (₹)</label><input type="number" min={0} className="form-input" value={form.creditLimitPaise} onChange={(e) => setForm({ ...form, creditLimitPaise: parseFloat(e.target.value) || 0 })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">{loading ? 'Saving...' : 'Add Customer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CustomerDetailModal({ customer, onClose, onSuccess }: { customer: Customer; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      await api.post(`/api/customers/${customer.id}/credit-payments`, {
        amountPaise: Math.round(parseFloat(amount) * 100),
        mode,
      });
      setSuccess(true);
      setTimeout(onSuccess, 1200);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-700 uppercase text-gray-900">{customer.name}</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-2 mb-5 text-sm text-gray-600">
          <div>Phone: <span className="font-500">{customer.phone}</span></div>
          <div>Credit Limit: <span className="font-display font-600">{formatINR(customer.creditLimitPaise)}</span></div>
          <div>Outstanding: <span className="font-display font-600 text-red-600">{formatINR(customer.outstandingCreditPaise)}</span></div>
        </div>

        {customer.outstandingCreditPaise > 0 && (
          success ? (
            <div className="flex items-center gap-2 text-green-600 py-4">
              <CheckCircle size={20} /> Payment recorded!
            </div>
          ) : (
            <form onSubmit={recordPayment} className="border-t pt-4 space-y-3">
              <h3 className="font-display font-600 uppercase text-sm text-gray-700">Record Payment</h3>
              {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 p-2 rounded">{error}</div>}
              <div><label className="form-label">Amount (₹)</label>
                <input type="number" min={1} required className="form-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div><label className="form-label">Mode</label>
                <select className="form-input" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                </select>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? 'Recording...' : 'Record Payment'}
              </button>
            </form>
          )
        )}
      </div>
    </div>
  );
}
