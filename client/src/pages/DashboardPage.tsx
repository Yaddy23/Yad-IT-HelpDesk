import { useAuth } from '@/lib/auth';

/** Phase 1 placeholder — Phase 2 replaces this with real dashboard metrics. */
export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome, {user?.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as {user?.email} · roles: {user?.roles.join(', ')}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['Open tickets', 'My queue', 'Pending approvals', 'SLA at risk'].map((label) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-foreground">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Available in Phase 2</p>
          </div>
        ))}
      </div>
    </div>
  );
}
