import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { LifeBuoyIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';

/** Full-screen loader shown while the session is restored. */
export function AuthGate() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-muted-foreground">
        <LifeBuoyIcon className="animate-spin" size={24} />
        <span className="text-sm">Restoring session…</span>
      </div>
    </div>
  );
}

/** Blocks anonymous access; optionally requires any one of `permissions`. */
export function ProtectedRoute({
  permissions,
  children,
}: {
  permissions?: string[];
  children?: ReactNode;
}) {
  const { user, loading, hasAnyPermission } = useAuth();
  const location = useLocation();

  if (loading) return <AuthGate />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (permissions && !hasAnyPermission(permissions)) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">Access denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account does not have permission to view this area. Ask an administrator if you
          believe this is a mistake.
        </p>
      </div>
    );
  }
  return children ?? <Outlet />;
}
