import { Route, Routes } from 'react-router-dom';

import AppShell from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import DashboardPage from '@/pages/DashboardPage';
import LoginPage from '@/pages/LoginPage';
import PlaceholderPage from '@/pages/PlaceholderPage';
import TicketCreatePage from '@/pages/TicketCreatePage';
import TicketDetailPage from '@/pages/TicketDetailPage';
import TicketsPage from '@/pages/TicketsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="tickets"
            element={<ProtectedRoute permissions={['tickets:read']}>
              <TicketsPage />
            </ProtectedRoute>}
          />
          <Route
            path="tickets/new"
            element={<ProtectedRoute permissions={['tickets:create']}>
              <TicketCreatePage />
            </ProtectedRoute>}
          />
          <Route
            path="tickets/:id"
            element={<ProtectedRoute permissions={['tickets:read']}>
              <TicketDetailPage />
            </ProtectedRoute>}
          />
          <Route
            path="approvals"
            element={<ProtectedRoute permissions={['approvals:decide']}>
              <PlaceholderPage title="Approvals" phase="Phase 5" />
            </ProtectedRoute>}
          />
          <Route
            path="admin/users"
            element={<ProtectedRoute permissions={['users:manage']}>
              <PlaceholderPage title="User Administration" phase="Phase 2 polish" />
            </ProtectedRoute>}
          />
          <Route
            path="admin/org"
            element={<ProtectedRoute permissions={['org:manage']}>
              <PlaceholderPage title="Organization" phase="Phase 2 polish" />
            </ProtectedRoute>}
          />
          <Route
            path="admin/settings"
            element={<ProtectedRoute permissions={['settings:manage']}>
              <PlaceholderPage title="System Settings" phase="Phase 6" />
            </ProtectedRoute>}
          />
          <Route
            path="admin/audit"
            element={<ProtectedRoute permissions={['audit:read']}>
              <PlaceholderPage title="Audit Log" phase="Phase 2 polish" />
            </ProtectedRoute>}
          />
          <Route path="*" element={<PlaceholderPage title="Not found" phase="—" />} />
        </Route>
      </Route>
    </Routes>
  );
}
