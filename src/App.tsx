import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useAuth } from './features/auth/AuthProvider'
import { SetupPage } from './features/auth/SetupPage'
import { LoadingState } from './components/Ui'

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
    <Route path="/accept-invite" element={<AcceptInvitePage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/organizations/select" element={<OrganizationSelectPage />} />
      <Route path="/org/:org" element={<OrganizationGuard />}>
        <Route index element={<Navigate replace to="my-work" />} />
        <Route path="my-work" element={<DashboardPage />} />
        <Route path="neighborhoods" element={<NeighborhoodsPage />} />
        <Route path="neighborhoods/:id" element={<NeighborhoodDetailPage />} />
        <Route path="homes/:id" element={<HomePage />} />
        <Route path="work/new" element={<NewWorkPage />} />
        <Route path="work/:id" element={<WorkDetailPage />} />
        <Route path="inspections" element={<InspectionsPage />} />
        <Route path="inspections/:id" element={<InspectionDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="sync" element={<SyncPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate replace to={auth.session ? '/organizations/select' : '/login'} />} />
  </Routes></Suspense>
}
