import { useEffect, useState } from 'react';

interface Health {
  status: string;
  service: string;
  version: string;
  time: string;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">ITSM Platform</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Phase 1 scaffold — API connection:{' '}
          {health ? (
            <span className="font-medium text-green-600">{health.status}</span>
          ) : error ? (
            <span className="font-medium text-red-600">unreachable ({error})</span>
          ) : (
            <span className="text-muted-foreground">checking…</span>
          )}
        </p>
      </div>
    </main>
  );
}
