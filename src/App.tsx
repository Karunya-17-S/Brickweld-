import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { HOME_BY_ROLE, canOpen, type NavKey } from "./lib/perms";
import { configError } from "./lib/supabase";
import { Layout } from "./components/Layout";
import { FormHost } from "./components/FormHost";
import { Loading } from "./components/ui";
import { LoginPage, NoRolePage } from "./pages/Login";

// Each screen is its own chunk so the first load on a site phone stays small.
const DashboardPage = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.DashboardPage })));
const ProjectsPage = lazy(() => import("./pages/Projects").then(m => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import("./pages/Projects").then(m => ({ default: m.ProjectDetailPage })));
const AttendancePage = lazy(() => import("./pages/Attendance").then(m => ({ default: m.AttendancePage })));
const AccountsPage = lazy(() => import("./pages/Accounts").then(m => ({ default: m.AccountsPage })));
const MaterialsPage = lazy(() => import("./pages/Materials").then(m => ({ default: m.MaterialsPage })));
const ContractorsPage = lazy(() => import("./pages/Contractors").then(m => ({ default: m.ContractorsPage })));
const MastersPage = lazy(() => import("./pages/Masters").then(m => ({ default: m.MastersPage })));
const ReportsPage = lazy(() => import("./pages/Reports").then(m => ({ default: m.ReportsPage })));
const AuditPage = lazy(() => import("./pages/Audit").then(m => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then(m => ({ default: m.SettingsPage })));

function Guard({ k, children }: { k: NavKey; children: ReactNode }) {
  const { role } = useAuth();
  if (!canOpen(role, k)) return <Navigate to={role ? HOME_BY_ROLE[role] : "/login"} replace />;
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export function App() {
  const { loading, session, role, active } = useAuth();
  if (configError) return <div className="m-10 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">{configError}</div>;
  if (loading) return <Loading text="Loading Brickweld…" />;
  if (!session) return <Routes><Route path="*" element={<LoginPage />} /></Routes>;
  if (!role || !active) return <NoRolePage />;
  return (
    <FormHost>
      <Routes>
        <Route path="/login" element={<Navigate to={HOME_BY_ROLE[role]} replace />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to={HOME_BY_ROLE[role]} replace />} />
          <Route path="/dashboard" element={<Guard k="dashboard"><DashboardPage /></Guard>} />
          <Route path="/projects" element={<Guard k="projects"><ProjectsPage /></Guard>} />
          <Route path="/projects/:id" element={<Guard k="projects"><ProjectDetailPage /></Guard>} />
          <Route path="/attendance" element={<Guard k="attendance"><AttendancePage /></Guard>} />
          <Route path="/accounts" element={<Guard k="accounts"><AccountsPage /></Guard>} />
          <Route path="/materials" element={<Guard k="materials"><MaterialsPage /></Guard>} />
          <Route path="/contractors" element={<Guard k="contractors"><ContractorsPage /></Guard>} />
          <Route path="/masters" element={<Guard k="masters"><MastersPage /></Guard>} />
          <Route path="/reports" element={<Guard k="reports"><ReportsPage /></Guard>} />
          <Route path="/audit" element={<Guard k="audit"><AuditPage /></Guard>} />
          <Route path="/settings" element={<Guard k="settings"><SettingsPage /></Guard>} />
          <Route path="*" element={<Navigate to={HOME_BY_ROLE[role]} replace />} />
        </Route>
      </Routes>
    </FormHost>
  );
}
