'use client';
// apps/erp/src/app/login/page.tsx
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ token: string; user: any }>('/api/auth/login', { email, password });
      localStorage.setItem('indus_token', res.token);
      localStorage.setItem('indus_user', JSON.stringify(res.user));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-orange-600 flex items-center justify-center">
            <span className="font-display font-800 text-white text-xl">I</span>
          </div>
          <div>
            <div className="font-display font-700 uppercase text-white text-lg leading-none">Indus</div>
            <div className="text-xs text-gray-400 uppercase tracking-widest">Staff Portal</div>
          </div>
        </div>

        <div className="bg-white rounded p-8 shadow-lg">
          <h1 className="font-display font-700 uppercase text-gray-900 text-2xl mb-1">Sign In</h1>
          <p className="text-sm text-gray-500 mb-6">Use your work credentials</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm mb-5">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                placeholder="you@indusmaterials.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="form-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center py-3"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          Contact your admin to reset your password.
        </p>
      </div>
    </div>
  );
}
