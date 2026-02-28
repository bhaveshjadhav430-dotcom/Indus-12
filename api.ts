// apps/erp/src/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_ERP_API_URL || 'http://localhost:4000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('indus_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('indus_token');
    localStorage.removeItem('indus_user');
    window.location.href = '/erp/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body: unknown, idempotencyKey?: string) =>
    request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
};

export function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function genIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
