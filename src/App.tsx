import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useAuth } from './features/auth/AuthProvider'
import { SetupPage } from './features/auth/SetupPage'
import { LoadingState } from './components/Ui'
import type { PermissionCode } from './types/domain'

const SignInPage = lazy(() => import('./features/auth/SignInPage').then((module) => ({ default: module.SignInPage })))
const AcceptInvitePage = lazy(() => import('./features/auth/AcceptInvitePage').then((module) => ({ default: module.AcceptInvitePage })))
const OrganizationSelectPage = lazy(() => import('./features/auth/OrganizationSelectPage').then((module) => ({ default: module.OrganizationSelectPage })))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const NeighborhoodsPage = lazy(() => import('./features/homes/NeighborhoodsPage').then((module) => ({ default: module.NeighborhoodsPage })))
const NeighborhoodDetailPage = lazy(() => import('./features/homes/NeighborhoodsPage').then((module) => ({ default: module.NeighborhoodDetailPage })))
const HomePage = lazy(() => import('./features/homes/HomePage').then((module) => ({ default: module.HomePage })))
const NewWorkPage = lazy(() => import('./features/work/NewWorkPage').then((module) => ({ default: module.NewWorkPage })))
const WorkDetailPage = lazy(() => import('./features/work/WorkDetailPage').then((module) => ({ default: module.WorkDetailPage })))
const InspectionsPage = lazy(() => import('./features/inspections/InspectionsPage').then((module) => ({ default: module.InspectionsPage })))
const InspectionDetailPage = lazy(() => import('./features/inspections/InspectionsPage').then((module) => ({ default: module.InspectionDetailPage })))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const AdminPage = lazy(() => import('./features/admin/AdminPage').then((module) => ({ default: module.AdminPage })))
const SyncPage = lazy(() => import('./features/sync/SyncPage').then((module) => ({ default: module.SyncPage })))
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })))
const UpdatePasswordPage = lazy(() => import('./features/auth/UpdatePasswordPage').then((module) => ({ default: module.UpdatePasswordPage })))
const AccountPage = lazy(() => import('./features/auth/AccountPage').then((module) => ({ default: module.AccountPage })))
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage').then((module) => ({ default: module.NotificationsPage })))

const workPermissions: PermissionCode[] = ['work.read_scope', 'work.create', 'work.triage', 'work.assign', 'work.execute_assigned', 'work.verify']
const structurePermissions: PermissionCode[] = ['structure.manage', ...workPermissions, 'inspection.manage', 'inspection.perform', 'report.read_scope']
const adminPermissions: PermissionCode[] = ['access.manage', 'structure.manage', 'roster.manage', 'config.manage', 'audit.read_scope']

function PermissionRoute({ anyOf, children }: { anyOf: PermissionCode[]; children: ReactNode }) {
  const { access, accessLoading, accessError, canAny } = useAuth()
  if (accessLoading) return <LoadingState label="Checking scoped access" />
  if (accessError || !access || !canAny(...anyOf)) return <section className="panel empty-state" role="alert"><h1>Access not granted</h1><p>{accessError ?? 'Your active roles do not permit this page. Ask an organization administrator to review your scope.'}</p></section>
  return children
}

function OrganizationLanding() {
  const { access, accessLoading, accessError, canAny } = useAuth()
  if (accessLoading) return <LoadingState label="Opening your workspace" />
  if (accessError || !access) return <section className="panel empty-state" role="alert"><h1>Workspace access unavailable</h1><p>{accessError ?? 'No active scoped roles were found for this organization.'}</p></section>
  if (canAny(...adminPermissions)) return <Navigate replace to="admin" />
  if (canAny('inspection.perform') && !canAny('work.assign', 'work.execute_assigned')) return <Navigate replace to="inspections" />
  if (canAny(...workPermissions)) return <Navigate replace to="my-work" />
  if (canAny('inspection.manage', 'inspection.perform')) return <Navigate replace to="inspections" />
  if (canAny('report.read_scope')) return <Navigate replace to="reports" />
  return <Navigate replace to="account" />
}

function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (!auth.configured) return <SetupPage />
  if (auth.loading) return <main className="centered-page"><LoadingState label="Restoring secure session" /></main>
  if (!auth.session) return <Navigate replace to="/login" state={{ from: location }} />
  return <Outlet />
}

function OrganizationGuard() {
  const { org } = useParams()
  const auth = useAuth()
  const selected = auth.organizations.find((item) => item.id === org)
  useEffect(() => {
    if (selected && selected.id !== auth.activeOrganization?.id) auth.setActiveOrganization(selected)
  }, [auth, selected])
  if (!selected) return <Navigate replace to="/organizations/select" />
  return <AppShell><Outlet /></AppShell>
}

export default function App() {
  const auth = useAuth()
  if (!auth.configured) return <SetupPage />
  return <Suspense fallback={<main className="centered-page"><LoadingState label="Loading BuildTrack" /></main>}><Routes>
    <Route path="/login" element={<SignInPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/auth/update-password" element={<UpdatePasswordPage />} />
    <Route path="/accept-invite" element={<AcceptInvitePage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/organizations/select" element={<OrganizationSelectPage />} />
      <Route path="/org/:org" element={<OrganizationGuard />}>
        <Route index element={<OrganizationLanding />} />
        <Route path="my-work" element={<PermissionRoute anyOf={workPermissions}><DashboardPage /></PermissionRoute>} />
        <Route path="neighborhoods" element={<PermissionRoute anyOf={structurePermissions}><NeighborhoodsPage /></PermissionRoute>} />
        <Route path="neighborhoods/:id" element={<PermissionRoute anyOf={structurePermissions}><NeighborhoodDetailPage /></PermissionRoute>} />
        <Route path="homes/:id" element={<PermissionRoute anyOf={structurePermissions}><HomePage /></PermissionRoute>} />
        <Route path="work/new" element={<PermissionRoute anyOf={['work.create']}><NewWorkPage /></PermissionRoute>} />
        <Route path="work/:id" element={<PermissionRoute anyOf={workPermissions}><WorkDetailPage /></PermissionRoute>} />
        <Route path="inspections" element={<PermissionRoute anyOf={['inspection.manage', 'inspection.perform']}><InspectionsPage /></PermissionRoute>} />
        <Route path="inspections/:id" element={<PermissionRoute anyOf={['inspection.manage', 'inspection.perform']}><InspectionDetailPage /></PermissionRoute>} />
        <Route path="reports" element={<PermissionRoute anyOf={['report.read_scope']}><ReportsPage /></PermissionRoute>} />
        <Route path="admin" element={<PermissionRoute anyOf={adminPermissions}><AdminPage /></PermissionRoute>} />
        <Route path="sync" element={<PermissionRoute anyOf={['work.create', 'work.execute_assigned', 'inspection.perform']}><SyncPage /></PermissionRoute>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate replace to={auth.session ? '/organizations/select' : '/login'} />} />
  </Routes></Suspense>
}
