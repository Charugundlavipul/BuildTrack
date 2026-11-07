import { Building2, ChevronRight } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LoadingState } from '../../components/Ui'
import { useAuth } from './AuthProvider'
import { usePlatformAccess } from '../platform/platformData'

export function OrganizationSelectPage() {
  const { organizations, activeOrganization, setActiveOrganization } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const platform = usePlatformAccess()
  const explicit = Boolean((location.state as { explicit?: boolean } | null)?.explicit)

  if (platform.isLoading) return <main className="centered-page"><LoadingState label="Opening your workspace" /></main>
  if (platform.data?.administrator && (!organizations.length || !explicit)) return <Navigate replace to="/platform" />
  if (!platform.data?.administrator && organizations.length === 1 && activeOrganization) return <Navigate replace to={`/org/${activeOrganization.id}`} />

  return (
    <main className="centered-page">
      <section className="select-card">
        <p className="eyebrow">WORKSPACE</p>
        <h1>Select an organization</h1>
        <p className="muted">Choose the organization you want to work with.</p>
        <div className="button-row" style={{ justifyContent: 'flex-start', marginBottom: '0.75rem' }}>
          <Link className="text-button" to="/account">My profile</Link>
          {platform.data?.administrator && <Link className="button primary" to="/platform">Super Admin portal</Link>}
        </div>
        <div className="organization-list">
          {organizations.map((organization) => (
            <button key={organization.id} className="organization-option" onClick={() => {
              setActiveOrganization(organization)
              navigate(`/org/${organization.id}`)
            }}>
              <span className="icon-tile"><Building2 /></span>
              <span><strong>{organization.name}</strong><small>{organization.timezone}</small></span>
              <ChevronRight />
            </button>
          ))}
          {!organizations.length && <div className="empty-state"><Building2 /><h2>No active membership</h2><p>An invitation must be accepted before organization data is available.</p></div>}
        </div>
      </section>
    </main>
  )
}
