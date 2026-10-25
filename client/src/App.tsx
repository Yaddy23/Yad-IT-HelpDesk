import { Route, Routes } from 'react-router-dom';

import AppShell from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import AssetDetailPage from '@/pages/AssetDetailPage';
import AssetsPage from '@/pages/AssetsPage';
import AssignmentsPage from '@/pages/AssignmentsPage';
import AuditLogPage from '@/pages/AuditLogPage';
import AuditsPage from '@/pages/AuditsPage';
import DashboardPage from '@/pages/DashboardPage';
import InventoryPage from '@/pages/InventoryPage';
import LicensesPage from '@/pages/LicensesPage';
import LoginPage from '@/pages/LoginPage';
import MaintenancePage from '@/pages/MaintenancePage';
import NotificationsPage from '@/pages/NotificationsPage';
import OrganizationPage from '@/pages/OrganizationPage';
import PlaceholderPage from '@/pages/PlaceholderPage';
import TicketCreatePage from '@/pages/TicketCreatePage';
import TicketDetailPage from '@/pages/TicketDetailPage';
import TicketsPage from '@/pages/TicketsPage';
import ProblemCreatePage from '@/pages/ProblemCreatePage';
import ProblemsPage from '@/pages/ProblemsPage';
import UsersPage from '@/pages/UsersPage';
import CatalogAdminPage from '@/pages/CatalogAdminPage';
import CatalogPage from '@/pages/CatalogPage';
import KnowledgeCreatePage from '@/pages/KnowledgeCreatePage';
import KnowledgeDetailPage from '@/pages/KnowledgeDetailPage';
import KnowledgePage from '@/pages/KnowledgePage';
import MyRequestsPage from '@/pages/MyRequestsPage';
import ApprovalsPage from '@/pages/ApprovalsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="catalog"
            element={<ProtectedRoute><CatalogPage /></ProtectedRoute>}
          />
          <Route
            path="my-requests"
            element={<ProtectedRoute><MyRequestsPage /></ProtectedRoute>}
          />
          <Route
            path="approvals"
            element={<ProtectedRoute permissions={['approvals:decide']}><ApprovalsPage /></ProtectedRoute>}
          />
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
            path="problems"
            element={<ProtectedRoute permissions={['problems:read']}>
              <ProblemsPage />
            </ProtectedRoute>}
          />
          <Route
            path="problems/new"
            element={<ProtectedRoute permissions={['problems:create']}>
              <ProblemCreatePage />
            </ProtectedRoute>}
          />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route
            path="knowledge"
            element={<ProtectedRoute permissions={['kb:read']}><KnowledgePage /></ProtectedRoute>}
          />
          <Route
            path="knowledge/new"
            element={<ProtectedRoute permissions={['kb:author']}><KnowledgeCreatePage /></ProtectedRoute>}
          />
          <Route
            path="knowledge/:id"
            element={<ProtectedRoute permissions={['kb:read']}><KnowledgeDetailPage /></ProtectedRoute>}
          />
          <Route
            path="assets"
            element={<ProtectedRoute permissions={['assets:read']}>
              <AssetsPage />
            </ProtectedRoute>}
          />
          <Route
            path="assets/assignments"
            element={<ProtectedRoute permissions={['assets:read']}>
              <AssignmentsPage />
            </ProtectedRoute>}
          />
          <Route
            path="assets/maintenance"
            element={<ProtectedRoute permissions={['assets:read']}>
              <MaintenancePage />
            </ProtectedRoute>}
          />
          <Route
            path="assets/inventory"
            element={<ProtectedRoute permissions={['assets:read']}>
              <InventoryPage />
            </ProtectedRoute>}
          />
          <Route
            path="assets/licenses"
            element={<ProtectedRoute permissions={['assets:read']}>
              <LicensesPage />
            </ProtectedRoute>}
          />
          <Route
            path="assets/audits"
            element={<ProtectedRoute permissions={['assets:read']}>
              <AuditsPage />
            </ProtectedRoute>}
          />
          <Route path="assets/:id"
            element={<ProtectedRoute permissions={['assets:read']}>
              <AssetDetailPage />
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
              <UsersPage />
            </ProtectedRoute>}
          />
          <Route
            path="admin/org"
            element={<ProtectedRoute permissions={['org:manage']}>
              <OrganizationPage />
            </ProtectedRoute>}
          />
          <Route
            path="admin/catalog"
            element={<ProtectedRoute permissions={['catalog:manage']}>
              <CatalogAdminPage />
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
              <AuditLogPage />
            </ProtectedRoute>}
          />
          <Route path="*" element={<PlaceholderPage title="Not found" phase="—" />} />
        </Route>
      </Route>
    </Routes>
  );
}